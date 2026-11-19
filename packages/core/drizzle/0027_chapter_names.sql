-- Custom SQL migration file, put your code below! --
-- M99: made-up chapter names were saved in the language of the profile that scanned them. They
-- are saved empty now and named where they show; only a name that matches its own place goes.
UPDATE `chapters` SET `title` = ''
WHERE (`found` = 0 AND `title` IN ('Chapter ' || (`idx` + 1), 'Bab ' || (`idx` + 1)))
  OR (`found` = 1 AND `title` IN ('Part ' || (`idx` + 1), 'Bahagian ' || (`idx` + 1)));
--> statement-breakpoint
-- A book of several files numbered each file's chapters from 1, as its files' chapters still
-- have them: each file adds its chapters to the book's list, or one chapter for the part.
WITH `spans` AS (
  SELECT `book_id`, `chapters_json`,
    SUM(MAX(json_array_length(`chapters_json`), 1)) OVER (PARTITION BY `book_id` ORDER BY `idx`)
      - MAX(json_array_length(`chapters_json`), 1) AS `first`
  FROM `book_files`
  WHERE `book_id` IS NOT NULL AND `missing_since` IS NULL AND json_valid(`chapters_json`)
)
UPDATE `chapters` SET `title` = ''
WHERE `found` = 0 AND `title` <> '' AND EXISTS (
  SELECT 1 FROM `spans` AS s
  WHERE s.`book_id` = `chapters`.`book_id`
    AND `chapters`.`idx` >= s.`first`
    AND `chapters`.`idx` < s.`first` + json_array_length(s.`chapters_json`)
    AND json_extract(s.`chapters_json`, '$[' || (`chapters`.`idx` - s.`first`) || '].title') = `chapters`.`title`
    AND `chapters`.`title` IN (
      'Chapter ' || (`chapters`.`idx` - s.`first` + 1),
      'Bab ' || (`chapters`.`idx` - s.`first` + 1)
    )
);
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
