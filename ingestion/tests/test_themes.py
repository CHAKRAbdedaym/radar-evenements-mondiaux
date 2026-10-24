"""Unit tests for radar_ingest.themes.classify (pure function, no network, no MongoDB).

Run inside the container:  docker compose run --rm --no-deps --entrypoint python enricher tests/test_themes.py
The QIDs are real Wikidata items (see themes_mapping.yaml). The `parents` dicts only exercise the
one-level P279 logic of the function.
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from radar_ingest import themes  # noqa: E402

M = themes.load_mapping()
REF = datetime(2026, 10, 17, 19, 25, tzinfo=timezone.utc)
FAILED = []


def check(name, got, theme, source, min_conf=None):
    ok = got.theme == theme and got.source == source and (min_conf is None or got.confidence >= min_conf) and got.reason
    print(("ok   " if ok else "FAIL ") + f"{name}: {tuple(got)}")
    if not ok:
        FAILED.append(name)


def main():
    assert [t[0] for t in themes.THEMES] == ["catastrophes", "conflits", "politique", "sport", "personnalites",
                                              "culture", "science", "economie", "sante", "autres"]
    assert themes.THEME_LABELS["catastrophes"] == "Catastrophes & accidents"
    assert themes.THEME_LABELS["economie"] == "Économie & entreprises"

    check("earthquake article (P31 Q7944)", themes.classify(M, lang="fr", title="Séisme de 2023 au Maroc", p31=["Q7944"]),
          "catastrophes", "wikidata", 0.95)
    check("film (P31 Q11424)", themes.classify(M, lang="en", title="Oppenheimer (film)", p31=["Q11424"]),
          "culture", "wikidata", 0.95)
    check("football match", themes.classify(M, lang="en", title="2026 FA Cup final", p31=["Q12166442"]),
          "sport", "wikidata")
    check("election (P31 Q40231)", themes.classify(M, lang="en", title="2026 Brazilian general election", p31=["Q40231"]),
          "politique", "wikidata")
    check("first mapped P31 wins", themes.classify(M, lang="en", title="x", p31=["Q35120", "Q7944", "Q11424"]),
          "catastrophes", "wikidata")
    check("footballer alive", themes.classify(M, lang="en", title="Some Player", p31=["Q5"], p106=["Q82955", "Q937857"]),
          "politique", "wikidata", 0.9)  # first P106 in claim order that is mapped
    check("footballer alive (only footballer)", themes.classify(M, lang="en", title="Some Player", p31=["Q5"], p106=["Q937857"]),
          "sport", "wikidata", 0.9)
    check("human died 3 days ago", themes.classify(M, lang="fr", title="Quelqu'un", p31=["Q5"], p106=["Q937857"],
                                                   p570=REF - timedelta(days=3), ref_time=REF),
          "personnalites", "wikidata", 0.95)
    check("human died 2 years ago -> occupation", themes.classify(M, lang="fr", title="Quelqu'un", p31=["Q5"], p106=["Q33999"],
                                                                  p570=REF - timedelta(days=730), ref_time=REF),
          "culture", "wikidata", 0.9)
    check("human without occupation", themes.classify(M, lang="en", title="Unknown Person", p31=["Q5"]),
          "personnalites", "wikidata", 0.6)
    check("occupation via P279", themes.classify(M, lang="en", title="p", p31=["Q5"], p106=["Q999999999"],
                                                 parents={"Q999999999": ["Q177220"]}),
          "culture", "wikidata", 0.8)
    check("P279 one level up", themes.classify(M, lang="en", title="y", p31=["Q999999998"], parents={"Q999999998": ["Q40231"]}),
          "politique", "wikidata", 0.8)
    check("P279 two levels is NOT followed", themes.classify(M, lang="en", title="y", p31=["Q999999998"],
                                                             parents={"Q999999998": ["Q999999997"], "Q999999997": ["Q40231"]}),
          "autres", "inconnu")
    check("list page stays autres", themes.classify(M, lang="en", title="List of earthquakes in 2026", p31=["Q13406463"],
                                                    categories=["Lists of earthquakes"]),
          "autres", "inconnu")
    check("disambiguation page", themes.classify(M, lang="fr", title="Paris (homonymie)", p31=["Q4167410"]),
          "autres", "inconnu")
    check("category keywords fr", themes.classify(M, lang="fr", title="Séisme de 1960 à Agadir", p31=[],
                                                  categories=["Séisme au Maroc", "1960 au Maroc"]),
          "catastrophes", "catégories", 0.6)
    check("category keywords en (footballers)", themes.classify(M, lang="en", title="A B", p31=[],
                                                                categories=["French footballers", "1990 births"]),
          "sport", "catégories")  # sport wins over the generic 'births' (personnalites)
    check("category keywords ar", themes.classify(M, lang="ar", title="x", categories=["زلزال المغرب", "كوارث في 2023"]),
          "catastrophes", "catégories")
    check("text keywords (title x2)", themes.classify(M, lang="en", title="Hurricane Ida", comments=["added death toll"]),
          "catastrophes", "mots-clés", 0.4)
    check("single weak text hit is not enough", themes.classify(M, lang="en", title="Something", comments=["fix typo, flood"]),
          "autres", "inconnu")
    # F2 fixes: places, generic parents, person keywords
    check("French commune -> lieu geographique (not politique)", themes.classify(M, lang="en", title="Boubiers", p31=["Q484170"]),
          "autres", "wikidata", 0.9)
    r = themes.classify(M, lang="en", title="Boubiers", p31=["Q484170"])
    assert r.reason.startswith("lieu géographique"), r
    check("place via P279 (village of Illinois-like class)", themes.classify(M, lang="en", title="x", p31=["Q999999996"],
                                                                         parents={"Q999999996": ["Q532"]}),
          "autres", "wikidata", 0.8)
    check("electoral unit is not followed through P279", themes.classify(M, lang="en", title="x", p31=["Q999999995"],
                                                                         parents={"Q999999995": ["Q192611"]}),
          "autres", "inconnu")
    check("disaster is not followed through P279", themes.classify(M, lang="en", title="Event X",
                                                                   p31=["Q999999994"], parents={"Q999999994": ["Q3839081"]}),
          "autres", "inconnu")
    check("violent crime -> conflits", themes.classify(M, lang="en", title="2017 storming", p31=["Q1520311"]),
          "conflits", "wikidata", 0.95)
    check("direct electoral unit still politique", themes.classify(M, lang="en", title="Cuttack", p31=["Q192611"]),
          "politique", "wikidata", 0.95)
    check("births category ignored for an item that is not a human", themes.classify(M, lang="en", title="Sol Oriens", p31=["Q999999993"],
                                                                                     categories=["2020 racehorse births"], has_qid=True),
          "autres", "inconnu")
    check("births category still works without a qid", themes.classify(M, lang="en", title="Some Person", p31=[],
                                                                       categories=["1980 births"], has_qid=False),
          "personnalites", "catégories")
    check("nothing known", themes.classify(M, lang="en", title="Zzzz", comments=["typo"]), "autres", "inconnu", 0.0)
    for res in (themes.classify(M, lang="fr", title="t"), themes.classify(M, lang="ar", title="t", p31=["Q7944"])):
        assert len(res) == 4 and res.reason, res
    print(f"mapping: {len(M.wikidata)} classes, {len(M.occupations)} occupations, {len(M.meta)} meta")
    if FAILED:
        print("FAILED:", FAILED)
        sys.exit(1)
    print("all tests passed")


if __name__ == "__main__":
    main()
