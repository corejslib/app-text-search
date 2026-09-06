import sql from "#core/sql";

export default sql`

CREATE EXTENSION IF NOT EXISTS softvisio_types;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE text_search_model (
    id serial4 PRIMARY KEY,
    name text NOT NULL UNIQUE,
    vector_dimensions int4 NOT NULL
);

CREATE TABLE text_search_document_type (
    id serial4 PRIMARY KEY,
    name text NOT NULL UNIQUE
);

CREATE SEQUENCE text_search_storage_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE text_search_storage (
    id int53 PRIMARY KEY DEFAULT nextval( 'text_search_storage_id_seq' ),
    model_id int4 NOT NULL REFERENCES text_search_model ( id ) ON DELETE RESTRICT,
    document_type_id int4 NOT NULL REFERENCES text_search_document_type ( id ) ON DELETE RESTRICT,
    store_content boolean NOT NULL,
    unique_document boolean NOT NULL
);

ALTER SEQUENCE text_search_storage_id_seq OWNED BY text_search_storage.id;

CREATE TABLE text_search_embedding (
    storage_id int53 NOT NULL REFERENCES text_search_storage ( id ) ON DELETE RESTRICT,
    embedding_id serial8 NOT NULL,
    content text NOT NULL,
    vector halfvec NOT NULL,
    PRIMARY KEY ( storage_id, embedding_id ),
    UNIQUE ( storage_id, content )
) PARTITION BY LIST ( storage_id );

CREATE SEQUENCE text_search_document_id_seq AS int8 MAXVALUE ${ Number.MAX_SAFE_INTEGER };

CREATE TABLE text_search_document (
    id int53 PRIMARY KEY DEFAULT nextval( 'text_search_document_id_seq' ),
    storage_id int53 NOT NULL,
    embedding_id int8 NOT NULL,
    created timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ( storage_id, embedding_id ) REFERENCES text_search_embedding ( storage_id, embedding_id ) ON DELETE RESTRICT
);

ALTER SEQUENCE text_search_document_id_seq OWNED BY text_search_document.id;

CREATE INDEX text_search_document_storage_id_embedding_id_idx ON text_search_document ( storage_id, embedding_id );

CREATE FUNCTION text_search_document_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    IF ( NOT EXISTS ( SELECT FROM text_search_document WHERE storage_id = OLD.storage_id AND embedding_id = OLD.embedding_id ) ) THEN
        DELETE FROM text_search_embedding WHERE storage_id = OLD.storage_id AND embedding_id = OLD.embedding_id;
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER text_search_document_after_delete AFTER DELETE ON text_search_document FOR EACH ROW EXECUTE FUNCTION text_search_document_after_delete_trigger();

CREATE VIEW text_search_document_view AS
    SELECT
        text_search_document.id,
        text_search_document.storage_id,
        text_search_document.created,
        text_search_embedding.content,
        text_search_embedding.vector
    FROM
        text_search_document,
        text_search_embedding
    WHERE
        text_search_document.storage_id = text_search_embedding.storage_id
        AND text_search_document.embedding_id = text_search_embedding.embedding_id
;

CREATE FUNCTION create_text_search_storage ( p_model_name text, p_document_type_name text, p_store_content bool, p_unique_document bool, p_createIndex boolean DEFAULT TRUE ) RETURNS int53 AS $$
DECLARE
    v_id int53;
BEGIN

    -- create storage
    INSERT INTO text_search_storage
    ( model_id, document_type_id, store_content, unique_document )
    VALUES
    (
        ( SELECT id FROM text_search_model WHERE name = p_model_name ),
        ( SELECT id FROM text_search_document_type WHERE name = p_document_type_name ),
        p_store_content,
        p_unique_document
    )
    RETURNING id INTO v_id;

    -- create partition
    EXECUTE 'CREATE TABLE
            text_search_embedding_' || v_id || ' ' ||
        'PARTITION OF
            text_search_embedding
        FOR VALUES IN ( ' || v_id || ' )';

    IF p_createIndex THEN
        CALL create_text_search_storage_index( v_id );
    END IF;

    RETURN v_id;

END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE delete_text_search_storage ( p_id int53 ) AS $$
BEGIN

    -- delete partition
    EXECUTE format( 'DROP TABLE IF EXISTS %I CASCADE', format( 'text_search_embedding_%s', p_id ) );

    -- delete storage
    DELETE FROM text_search_storage WHERE id = p_id;

END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE create_text_search_storage_index ( p_storage_id int53 ) AS $$
BEGIN

    -- create index
    EXECUTE format( 'CREATE INDEX IF NOT EXISTS %I ON %I USING hnsw ( ( vector::halfvec( %s ) ) halfvec_cosine_ops )', format( 'text_search_embedding_%s_vector_idx', p_storage_id ), format( 'text_search_embedding_%s', p_storage_id ), ( SELECT vector_dimensions FROM text_search_storage, text_search_model WHERE text_search_storage.model_id = text_search_model.id AND text_search_storage.id = p_storage_id ) );

END;
$$ LANGUAGE plpgsql;

CREATE PROCEDURE delete_text_search_storage_index ( p_storage_id int53 ) AS $$
BEGIN

    -- delete index
    EXECUTE format( 'DROP INDEX IF EXISTS %I', format( 'text_search_embedding_%s_vector_idx', p_storage_id ) );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_document_vector ( _document_id int53 ) RETURNS halfvec STABLE AS $$
BEGIN

    RETURN (
        SELECT
            vector
        FROM
            text_search_document_view
        WHERE
            id = _document_id
    );

END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION create_text_search_document ( _storage_id int53, _content text, _vector halfvec ) RETURNS int53 AS $$
DECLARE
    _document_id int53;
    _embedding_id int8;
BEGIN
    _embedding_id := ( SELECT embedding_id FROM text_search_embedding WHERE storage_id = _storage_id AND content = _content );

    -- embedding is not exists
    IF _embedding_id IS NULL THEN
        IF _vector IS NULL THEN
            RETURN NULL;
        ELSE

            -- create embedding
            INSERT INTO
                text_search_embedding
            ( storage_id, content, vector )
            VALUES
            ( _storage_id, _content, _vector )
            RETURNING embedding_id INTO _embedding_id;
        END IF;
    END IF;

    -- create document
    IF ( SELECT unique_document FROM text_search_storage WHERE id = _storage_id ) THEN
        SELECT id FROM text_search_document WHERE storage_id = _storage_id AND embedding_id = _embedding_id INTO _document_id;

        IF _document_id IS NOT NULL THEN
            RETURN _document_id;
        END IF;
    END IF;

    -- create document
    INSERT INTO
        text_search_document
    ( storage_id, embedding_id )
    VALUES
    ( _storage_id, _embedding_id )
    RETURNING id INTO _document_id;

    RETURN _document_id;
END;
$$ LANGUAGE plpgsql;

`;
