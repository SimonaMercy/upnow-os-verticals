# Dubai Land Department official artwork

The Ejari Unified Tenancy Contract print template ([rental-provider/dashboard/contracts/[id]/print/page.tsx](../../src/app/rental-provider/dashboard/contracts/%5Bid%5D/print/page.tsx)) loads two logo files from this folder:

| File | What it is | Where it appears |
|---|---|---|
| `government-of-dubai.png` | Government of Dubai emblem + Arabic/English wordmark | Top-left of each contract page header |
| `land-department.png` | Dubai Land Department palm-tree logo + wordmark | Top-right of each contract page header |

## Source

Use the **official artwork from your DLD/Ejari licensed source**. Do **not** scrape from search results or unofficial sites — the contract is a legal document and must use the authoritative file.

Typical sources:
- DLD partner portal / Ejari registration kit
- Government of Dubai brand-asset library
- Your existing Ejari contract template (extract the embedded images from the PDF)

## Recommended export settings

- Format: **PNG** with transparent background
- Height: **~200 px** (the header renders them at 56px; 200px gives ~3.5× pixel density for crisp print at 300dpi)
- Width: auto (preserve aspect ratio)
- Profile: sRGB

## Where to drop the files

```
public/dld/
├── government-of-dubai.png    ← drop here
├── land-department.png        ← drop here
└── README.md                  ← this file
```

No code changes needed — the print page references them by path.
