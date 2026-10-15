"""Al Haouz earthquake replay definition (contract section 7).

`titles_counted` mirrors ingestion/config/watchlist.json (the backend image cannot see
the ingestion folder, so the lists are duplicated here). Views of a redirect are counted
under the redirect's name in the dumps, hence every title of the list is summed.
"""
from datetime import datetime, timezone

EVENT = {"name": "Séisme d'Al Haouz", "time": datetime(2023, 9, 8, 22, 11, tzinfo=timezone.utc)}
START = datetime(2023, 9, 8, 12, tzinfo=timezone.utc)
END = datetime(2023, 9, 10, 12, tzinfo=timezone.utc)

SERIES = [
    {
        "lang": "ar",
        "title": "زلزال الحوز 2023",
        "title_at_time": "زلزال مراكش-آسفي 2023",
        "titles_counted": [
            "زلزال الحوز 2023", "زلزال مراكش-آسفي 2023", "زلزال مراكش آسفي 2023",
            "زلزال المغرب 2023", "زلزال الحوز", "زلزال مراكش", "زلزال إغيل 2023",
        ],
    },
    {
        "lang": "fr",
        "title": "Séisme de 2023 au Maroc",
        "title_at_time": "Séisme de 2023 au Maroc",
        "titles_counted": ["Séisme de 2023 au Maroc"],
    },
    {
        "lang": "en",
        "title": "2023 Al Haouz earthquake",
        "title_at_time": "2023 Marrakesh-Safi earthquake",
        "titles_counted": [
            "2023 Al Haouz earthquake", "2023 Marrakesh-Safi earthquake",
            "2023 Marrakesh–Safi earthquake", "2023 Morocco earthquake",
            "2023 Moroccan earthquake", "2023 Chichaoua earthquake", "2023 Moroco earthquake",
        ],
    },
]
