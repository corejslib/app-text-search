# API

## Simple search

Functions:

`normalize_nfc ( text )` - normalize unicode. For example: `e\u{301}` ( `e ́` ) to `é`.

`normalize_nfc_casefold ( text )` - used for case-insensitive comparison. Normalize NFC and case. For example: `UPPER straße` to `upper strasse`.

PostgreSQL:

`ILIKE` in PostgreSQL use `LOWER` to normalize case. `casefold()` is more correct than `LOWER` so we use `normalize_nfc_casefold()` function instead of `ILIKE`.

```sql
CREATE EXTENSION IF NOT EXISTS softvisio;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE t (
    id serial8 PRIMARY KEY,
    col text NOT NULL
);

-- create only the indexes that you use

-- LIKE: "=" and prefix search ( 'abc%' )
CREATE INDEX t_col_normalize_nfc_idx ON t ( normalize_nfc( col ) text_pattern_ops );

-- LIKE: substring search ( '%abc%' ), patterns shorter than 3 characters are not accelerated
CREATE INDEX t_col_normalize_nfc_trgm_idx ON t USING gin ( normalize_nfc( col ) gin_trgm_ops );

-- ILIKE: "=" and prefix search ( 'abc%' )
CREATE INDEX t_col_normalize_nfc_casefold_idx ON t ( normalize_nfc_casefold( col ) text_pattern_ops );

-- ILIKE: substring search ( '%abc%' )
CREATE INDEX t_col_normalize_nfc_casefold_trgm_idx ON t USING gin ( normalize_nfc_casefold( col ) gin_trgm_ops );

-- was: col LIKE $1
-- SELECT * FROM t WHERE normalize_nfc( col ) LIKE normalize_nfc( $1 );

-- was: col ILIKE $1
-- SELECT * FROM t WHERE normalize_nfc_casefold( col ) LIKE normalize_nfc_casefold( $1 );
```

SQLite:

In SQLite `LIKE` is case-insensitive, so we use `normalize_nfc()` to make if case-sensitive, like in PostgreSQL.

In SQLite we use `normalize_nfc_casefold()` for case-insensitive search because there is no `ILIKE` and `LOWER` works only with `ASCII` charset.

```sql
CREATE TABLE t (
    id INTEGER PRIMARY KEY,
    col TEXT NOT NULL
);

-- create only the indexes that you use

-- LIKE: "=" search
CREATE INDEX t_col_normalize_nfc_idx ON t ( normalize_nfc( col ) );

-- ILIKE: "=" search
CREATE INDEX t_col_normalize_nfc_casefold_idx ON t ( normalize_nfc_casefold( col ) );

-- ILIKE: substring search ( '%abc%' ), patterns shorter than 3 characters fall back to scan
-- normalized values are stored only inside this index table
CREATE VIRTUAL TABLE t_fts USING fts5 ( col_normalized, tokenize = 'trigram' );

CREATE TRIGGER t_ai AFTER INSERT ON t BEGIN
    INSERT INTO t_fts ( rowid, col_normalized ) VALUES ( new.id, normalize_nfc_casefold( new.col ) );
END;

CREATE TRIGGER t_ad AFTER DELETE ON t BEGIN
    DELETE FROM t_fts WHERE rowid = old.id;
END;

CREATE TRIGGER t_au AFTER UPDATE OF col ON t BEGIN
    UPDATE t_fts SET col_normalized = normalize_nfc_casefold( new.col ) WHERE rowid = old.id;
END;

-- fill the index for existing rows
-- INSERT INTO t_fts ( rowid, col_normalized ) SELECT id, normalize_nfc_casefold( col ) FROM t;

-- SQLite LIKE has no default escape character, PostgreSQL uses backslash,
-- so ESCAPE '\' is required to make patterns like 'a\%b' work the same way

-- was: col LIKE ?
-- SELECT * FROM t WHERE normalize_nfc( col ) LIKE normalize_nfc( ? ) ESCAPE '\';

-- was: col ILIKE ?
-- SELECT * FROM t WHERE id IN ( SELECT rowid FROM t_fts WHERE col_normalized LIKE normalize_nfc_casefold( ? ) );

-- ESCAPE disables the trigram index of FTS5 (checked on SQLite 3.45.1, it falls back to a scan of t_fts),
-- so for ILIKE add ESCAPE '\' only if the pattern contains a backslash, the result is the same without it:
-- SELECT * FROM t WHERE id IN ( SELECT rowid FROM t_fts WHERE col_normalized LIKE normalize_nfc_casefold( ? ) ESCAPE '\' );
```

## Full-text search

```sql
CREATE TABLE document (
    text text,
    landuage text,
    tsvector tsvector
);

CREATE INDEX document_tsvector_idx ON document USING GIN ( tsvector );

-- NOTE: you will need to insert / update tsvector column using triggers
UPDATE document SET tsvector = get_text_search_tsvector( text, language );

SELECT
    text,
    ts_rank( tsvector, get_text_search_tsquery( 'search query' ) ) AS rank
FROM
    document
WHERE
    tsvctor @@ get_text_search_tsquery( 'search query' )
ORDER BY
    rank DESC;
```

Note: Rank calculation can be slow on large result sets, because it unable to use indexes, so use it with caution.

If your documents has known language or if you don't need to rank results, you can simplify SQL structire:

```sql
CREATE TABLE document (
    text text
);

CREATE INDEX document_text_tsvector_idx ON document USING GIN ( get_text_search_tsvector( text, 'english' ) );

SELECT
    text
FROM
    document
WHERE
    get_text_search_tsvector( text, 'english' ) @@ get_text_search_tsquery( 'search query', 'english' );
```

## Similarity search

```sql
CREATE TABLE document (
    id serial8 PRIMARY KEY,
    content text NOT NULL,
    text_search_document_id int53 NOT NULL REFERENCES text_search_document ( id ) ON DELETE RESTRICT
);

CREATE FUNCTION document_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    DELETE FROM text_search_document WHERE id = OLD.text_search_document_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER document_after_delete AFTER DELETE ON document FOR EACH ROW EXECUTE FUNCTION document_after_delete_trigger();

CREATE TABLE query (
    id serial8 PRIMARY KEY,
    content text NOT NULL,
    text_search_document_id int53 NOT NULL REFERENCES text_search_document ( id ) ON DELETE RESTRICT
);

CREATE FUNCTION query_after_delete_trigger () RETURNS trigger AS $$
BEGIN
    DELETE FROM text_search_document WHERE id = OLD.text_search_document_id;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER query_after_delete AFTER DELETE ON query FOR EACH ROW EXECUTE FUNCTION query_after_delete_trigger();
```

Create documents

```javascript
// create documents storage
const documentsStorage = await this.app.textSearch.createStorage( "text-embedding-3-small", "RETRIEVAL_DOCUMENT" );

if ( documentsStorage.ok ) {

    // XXX store documentsStorage.data.id somewhere
}

// create document
const document = await this.app.textSearch.createDocument( documentsStorage.data.id, "DOCUMENT TEXT" );

if ( document.ok ) {

    // XXX store document.data.id in text_search_document_id
}
```

Create queries

```javascript
// create queries storage
const queriesStorage = await this.app.textSearch.createStorage( "text-embedding-3-small", "RETRIEVAL_QUERY" );

if ( queriesStorage.ok ) {

    // XXX store queriesStorage.data.id somewhere
}

// create query
const query = await this.app.textSearch.createDocument( queriesStorage.data.id, "QUERY TEXT" );

if ( query.ok ) {

    // XXX store query.data.id in text_search_document_id
}
```

Search documents similar to the query

```javascript
const storageId = 1,
    storageEmbeddingSize = await this.app.textSearch.getStorageEmbeddingSize( storageId ),
    distanceThreshold = 0.2,
    queryDocumentId = 1;

const res = await dbh.select( sql`
SELECT
    document.id,
    ts.vector::halfvec( ${ sql( storageEmbeddingSize ) } ) <=> get_text_search_document_vector( ${ queryDocumentId }::int53 ) AS distance
FROM
    document,
    text_search_document_view AS ts
WHERE
    document.text_search_document_id = ts.id
    AND ts.storage_id = ${ storageId }
    AND ( ts.vector::halfvec( ${ sql( storageEmbeddingSize ) } ) <=> get_text_search_document_vector( ${ queryDocumentId }::int53 ) ) <= ${ distanceThreshold }
ORDER BY
    ts.vector::halfvec( ${ sql( storageEmbeddingSize ) } ) <=> get_text_search_document_vector( ${ queryDocumentId }::int53 )
LIMIT 10
` );
```

NOTES:

- Cosine distance is between `0` and `2`. Less value means document more similar with the query, `0` - means documents are 100% similar.

- `ORDER BY` distance must be `ASC` only, otherwise index will not be used.
