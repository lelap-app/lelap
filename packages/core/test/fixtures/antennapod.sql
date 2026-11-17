-- A trimmed AntennaPod database export: the columns Lelap reads, named as in PodDBAdapter.
CREATE TABLE Feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, custom_title TEXT, file_url TEXT, download_url TEXT, downloaded INTEGER, link TEXT, state INTEGER DEFAULT 0);
CREATE TABLE FeedItems (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, pubDate INTEGER, read INTEGER, link TEXT, media INTEGER, feed INTEGER, item_identifier TEXT);
CREATE TABLE FeedMedia (id INTEGER PRIMARY KEY AUTOINCREMENT, duration INTEGER, file_url TEXT, download_url TEXT, downloaded INTEGER, position INTEGER, playback_completion_date INTEGER, feeditem INTEGER, played_duration INTEGER, last_played_time INTEGER);
INSERT INTO Feeds (id, title, download_url, state) VALUES
  (1, 'The Garden Hour', 'https://feeds.example.org/garden-hour.xml', 0),
  (2, 'Old show', 'https://feeds.example.org/old.xml', 1),
  (3, 'My recordings', 'antennapod_local:content://tree/recordings', 0),
  (4, 'Gone away', 'https://feeds.example.org/gone.xml', 0);
INSERT INTO FeedItems (id, title, read, feed, item_identifier) VALUES
  (10, 'Episode 1', 1, 1, 'ep-1'),
  (11, 'Episode 2', 0, 1, 'ep-2'),
  (12, 'Episode 3', -1, 1, NULL),
  (13, 'Lost episode', 1, 1, 'ep-99'),
  (14, 'Archived', 1, 2, 'old-1'),
  (15, 'Gone episode', 0, 4, 'g-1');
INSERT INTO FeedMedia (id, duration, download_url, position, playback_completion_date, feeditem, last_played_time) VALUES
  (20, 60000, 'https://cdn.example.org/ep1.mp3', 0, 1700000000000, 10, 1700000000000),
  (21, 120000, 'https://cdn.example.org/ep2.mp3', 45000, 0, 11, 1700000500000),
  (22, 180000, 'https://cdn.example.org/ep3.mp3', 0, 0, 12, 0),
  (23, 60000, 'https://cdn.example.org/ep99.mp3', 0, 0, 13, 0),
  (24, 60000, 'https://cdn.example.org/old1.mp3', 0, 0, 14, 0),
  (25, 60000, 'https://cdn.example.org/g1.mp3', 1000, 0, 15, 0);
