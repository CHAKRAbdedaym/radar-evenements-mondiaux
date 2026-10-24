// Runs once, on the first start of an empty /data/db (docker-entrypoint-initdb.d).
// Idempotent: createCollection is guarded and createIndex is a no-op for identical specs.
// Indexes follow docs/CONTRACT.md section 5 exactly.
const radar = db.getSiblingDB("radar");

const collections = ["edits", "edit_texts", "pageviews", "alerts", "scores", "ingestion_log", "articles", "wikidata_entities", "events"];
const existing = radar.getCollectionNames();
collections.forEach((name) => {
  if (!existing.includes(name)) {
    radar.createCollection(name);
    print("[init] created collection radar." + name);
  }
});

// 5.1 edits
radar.edits.createIndex({ timestamp: -1 });
radar.edits.createIndex({ lang: 1, title: 1, timestamp: -1 });
radar.edits.createIndex({ bot: 1, timestamp: -1 });
radar.edits.createIndex({ ingested_at: -1 });

// 5.2 edit_texts
radar.edit_texts.createIndex(
  { added_text: "text", comment: "text" },
  { name: "text_search", default_language: "none" }
);
radar.edit_texts.createIndex({ timestamp: -1 });
radar.edit_texts.createIndex({ lang: 1, title: 1, timestamp: -1 });

// 5.3 pageviews
radar.pageviews.createIndex({ lang: 1, title: 1, hour: 1 }, { unique: true });
radar.pageviews.createIndex({ hour: 1, views: -1 });

// 5.4 alerts
radar.alerts.createIndex({ created_at: -1 });
radar.alerts.createIndex({ lang: 1, title: 1, created_at: -1 });
radar.alerts.createIndex({ z_score: -1 });
radar.alerts.createIndex({ event_id: 1 });
radar.alerts.createIndex({ window_end: -1 });

// 5.5 scores (TTL 1 h)
radar.scores.createIndex({ computed_at: 1 }, { expireAfterSeconds: 3600 });

// 5.6 ingestion_log
radar.ingestion_log.createIndex({ source: 1, hour: 1 });

// 5.7 articles (v2, written by the enricher)
radar.articles.createIndex({ theme: 1 });
radar.articles.createIndex({ qid: 1 });
radar.articles.createIndex({ theme_source: 1 });
radar.articles.createIndex({ enriched_at: 1 });
radar.articles.createIndex({ lang: 1, theme: 1 });

// 5.8 wikidata_entities (v2, cache of Wikidata items)
radar.wikidata_entities.createIndex({ fetched_at: 1 });

// 5.9 events (v2 / v2.1, maintained by the detector)
radar.events.createIndex({ significance: -1 });
radar.events.createIndex({ theme: 1, last_activity: -1 });
radar.events.createIndex({ status: 1, last_activity: -1 });
radar.events.createIndex({ key: 1, last_activity: -1 });
radar.events.createIndex({ qid: 1 });
radar.events.createIndex({ peak_z: -1 });

print("[init] radar database initialised");
