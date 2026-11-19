-- Custom SQL migration file, put your code below! --
-- M99: made-up chapter names were saved in the language of the profile that scanned them. They
-- are saved empty now and named where they show; only a name that matches its own place goes.
UPDATE `chapters` SET `title` = ''
WHERE (`found` = 0 AND `title` IN ('Chapter ' || (`idx` + 1), 'Bab ' || (`idx` + 1)))
  OR (`found` = 1 AND `title` IN ('Part ' || (`idx` + 1), 'Bahagian ' || (`idx` + 1)));
--> statement-breakpoint
UPDATE `book_files` SET `chapters_json` = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.title') IN ('Chapter ' || (c.key + 1), 'Bab ' || (c.key + 1))
      THEN json_set(c.value, '$.title', '')
    ELSE c.value
  END))
  FROM (SELECT `key`, `value` FROM json_each(`book_files`.`chapters_json`) ORDER BY `key`) AS c
)
WHERE json_valid(`chapters_json`) AND EXISTS (
  SELECT 1 FROM json_each(`book_files`.`chapters_json`) AS c
  WHERE json_extract(c.value, '$.title') IN ('Chapter ' || (c.key + 1), 'Bab ' || (c.key + 1))
);
--> statement-breakpoint
UPDATE `own_chapters` SET `chapters` = (
  SELECT json_group_array(json(CASE
    WHEN json_extract(c.value, '$.title') IN ('Chapter ' || (c.key + 1), 'Bab ' || (c.key + 1))
      THEN json_set(c.value, '$.title', '')
    ELSE c.value
  END))
  FROM (SELECT `key`, `value` FROM json_each(`own_chapters`.`chapters`) ORDER BY `key`) AS c
)
WHERE `chapters` IS NOT NULL AND json_valid(`chapters`) AND EXISTS (
  SELECT 1 FROM json_each(`own_chapters`.`chapters`) AS c
  WHERE json_extract(c.value, '$.title') IN ('Chapter ' || (c.key + 1), 'Bab ' || (c.key + 1))
);
