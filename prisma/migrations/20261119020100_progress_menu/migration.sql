-- "Progres" is on for every existing token (a separate migration: a new enum
-- value can't be used in the transaction that adds it).
UPDATE "access_tokens"
SET "menus" = array_append("menus", 'PROGRESS'::"Menu")
WHERE NOT ('PROGRESS'::"Menu" = ANY ("menus"));
