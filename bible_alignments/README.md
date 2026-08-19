# bible_alignments

Python package for reading, validating, and working with Bible word-alignment data in [Scripture Burrito](https://docs.burrito.bible/en/latest/) format.

## Package layout

```
bible_alignments/
├── __init__.py       # Root constants, SourceidEnum, normalize_strongs
├── strongs.py        # Strong's number normalization utilities
├── catalog.py        # Catalog: reads all alignment TOML metadata, writes catalog.tsv
└── burrito/          # Core Scripture Burrito alignment model
    ├── AlignmentSet.py    # AlignmentSet: file-path configuration for one alignment
    ├── AlignmentGroup.py  # AlignmentGroup, AlignmentRecord, AlignmentReference, Document, Metadata
    ├── AlignmentType.py   # TranslationType
    ├── alignments.py      # AlignmentsReader: reads alignment JSON files
    ├── manager.py         # Manager: loads all data for an AlignmentSet into VerseData
    ├── source.py          # Source, SourceReader: manuscript/source-text tokens
    ├── target.py          # Target, TargetReader: translation tokens
    ├── BaseToken.py       # BaseToken shared by Source and Target
    ├── VerseData.py       # VerseData: sources, targets, and aligned pairs for one verse
    ├── BadRecord.py       # BadRecord, Reason: malformed-alignment tracking
    └── util.py            # groupby_bcv and other helpers
```

## Quick start

```python
from bible_alignments.burrito import DATAPATH, AlignmentSet, Manager

alset = AlignmentSet(
    sourceid="SBLGNT",
    targetid="LEB",
    targetlanguage="eng",
    langdatapath=DATAPATH.parent.parent / "alignments-eng/data",
)
mgr = Manager(alset)

# VerseData keyed by BCV string (book-chapter-verse, zero-padded)
verse = mgr["40001001"]   # Matthew 1:1
for sources, targets in verse.alignments:
    print([s.text for s in sources], "->", [t.text for t in targets])
```

## Key classes

### `AlignmentSet`

Holds all path configuration for one alignment (source text, target translation, alignment JSON, metadata TOML). Validates identifiers and resolves file paths.

```python
AlignmentSet(sourceid="WLC", targetid="ESV", targetlanguage="eng",
             langdatapath=..., alternateid="manual")
alset.identifier     # "WLC-ESV-manual"
alset.canon          # "ot"
alset.check_files()  # raises ValueError if any file is missing
```

### `Manager`

Loads an `AlignmentSet` into memory. Acts as a `dict[str, VerseData]` keyed by BCV string. Detects and reports bad alignment records (missing tokens, empty selectors).

```python
mgr = Manager(alset)
mgr["40001024"]                           # <VerseData: 40001024>
mgr.token_alignments("love", role="target")  # records containing "love"
mgr.badrecords                            # dict of malformed records
```

### `VerseData`

Aggregates all data for one verse: source tokens, target tokens, and the list of `(sources, targets)` alignment pairs.

### `AlignmentGroup` / `AlignmentRecord`

Low-level Scripture Burrito model. An `AlignmentGroup` holds a list of `AlignmentRecord` instances, each pairing source and target token selectors via `AlignmentReference` objects.

### `Source` / `Target`

Token objects loaded from TSV files. Both inherit from `BaseToken` and expose `.text`, `.id`, and other attributes from the manuscript or translation data.

### `Catalog`

Reads TOML metadata files for all alignments under `data/alignments/` and writes a tab-separated `data/catalog.tsv`.

```python
from bible_alignments import catalog
catalog.Catalog().write()
```

### `normalize_strongs`

Normalises Strong's numbers from various source formats into a canonical form (`H0001`, `G3056`, etc.).

```python
from bible_alignments import normalize_strongs
normalize_strongs("G29620")   # "G2962"
normalize_strongs(3056, prefix="G")  # "G3056"
```

## Source identifiers

Recognized source texts are defined in `SourceidEnum`:

| ID | Canon |
|----|-------|
| `WLC` | OT |
| `WLCM` | OT |
| `BGNT` | NT |
| `NA27` | NT |
| `NA28` | NT |
| `SBLGNT` | NT |

## Data paths

Path constants are exported from the package root:

```python
from bible_alignments import DATAPATH, SOURCES, TARGETS, ALIGNMENTS, NAMES
```

All paths are resolved relative to the repository root.
