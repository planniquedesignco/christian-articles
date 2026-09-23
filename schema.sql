PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  site_name TEXT NOT NULL DEFAULT 'Grace in Every Season',
  tagline TEXT NOT NULL DEFAULT 'Faith • Scripture • Everyday Life',
  hero_title TEXT NOT NULL DEFAULT 'Finding grace in every season.',
  hero_intro TEXT NOT NULL DEFAULT 'Thoughtful Christian reflections on Scripture, prayer, spiritual growth and the quiet ways faith meets us in everyday life.',
  hero_image TEXT DEFAULT '',
  author_name TEXT NOT NULL DEFAULT 'Author Name',
  author_short_bio TEXT NOT NULL DEFAULT 'Christian writer on faith, Scripture and everyday life.',
  author_full_bio TEXT NOT NULL DEFAULT '',
  author_image TEXT DEFAULT '',
  instagram_url TEXT DEFAULT '',
  facebook_url TEXT DEFAULT '',
  youtube_url TEXT DEFAULT '',
  contact_email TEXT DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO site_settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category_id INTEGER,
  excerpt TEXT DEFAULT '',
  highlight TEXT DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  closing TEXT DEFAULT '',
  cover_image TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
CREATE INDEX IF NOT EXISTS idx_articles_category ON articles(category_id);
CREATE INDEX IF NOT EXISTS idx_articles_published_at ON articles(published_at);
CREATE INDEX IF NOT EXISTS idx_articles_pinned ON articles(is_pinned, sort_order);

INSERT OR IGNORE INTO categories (id,name,slug,description,sort_order) VALUES
(1,'Faith & Life','faith-life','Finding God in ordinary life, waiting, change and spiritual growth.',10),
(2,'Prayer','prayer','Reflections on prayer, silence, trust and drawing nearer to God.',20),
(3,'Bible Study','bible-study','Reading Scripture carefully and applying biblical truth to everyday life.',30),
(4,'Christian Living','christian-living','Living faith through habits, relationships, choices and daily discipleship.',40),
(5,'Church & Community','church-community','Belonging, service, fellowship and following Christ together.',50),
(6,'Testimony','testimony','Stories of grace, lessons, questions and God''s faithfulness.',60);
