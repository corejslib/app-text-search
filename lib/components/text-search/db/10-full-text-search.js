import sql from "#core/sql";

export default sql`

CREATE FUNCTION get_text_search_tsvector ( p_content text ) RETURNS tsvector IMMUTABLE AS $$
BEGIN
    RETURN get_text_search_tsvector ( p_content, NULL );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_tsvector ( p_content text, p_language regconfig ) RETURNS tsvector IMMUTABLE AS $$
BEGIN
    IF p_language IS NOT NULL THEN
        RETURN (
            SELECT to_tsvector( p_language, p_content )
        );
    ELSE
        RETURN (
            SELECT
                setweight( to_tsvector( 'simple', p_content ), 'A' ) || setweight( tsvector, 'B' )
            FROM
                pg_ts_config,
                LATERAL to_tsvector( cfgname::regconfig, p_content ) AS tsvector
            WHERE
                cfgname != 'simple'
            ORDER BY
                length( tsvector ),
                length( tsvector::text )
            LIMIT 1
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_tsquery ( p_content text ) RETURNS tsquery IMMUTABLE AS $$
BEGIN
    RETURN get_text_search_tsquery ( p_content, NULL );
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION get_text_search_tsquery ( p_content text, p_language regconfig ) RETURNS tsquery IMMUTABLE AS $$
BEGIN
    IF p_language IS NOT NULL THEN
        RETURN (
            SELECT to_tsvector( p_language, p_content )
        );
    ELSE
        RETURN (
            SELECT
                tsquery
            FROM
                pg_ts_config,
                LATERAL websearch_to_tsquery( cfgname::regconfig, p_content ) AS tsquery
            WHERE
                cfgname != 'simple'
            ORDER BY
                length( tsquery::text )
            LIMIT 1
        );
    END IF;
END;
$$ LANGUAGE plpgsql;

`;
