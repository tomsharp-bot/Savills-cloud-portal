# Morning photo ingest

A Linux job can add photos to a project's Photos Pool without signing in to the portal. The endpoint lives at the **domain root** (not under `/projectprogress`). It uses the same Spaces keys, database rows, and thumbnails as a drag-and-drop upload in Photo Storage.

Set **`PHOTO_INGEST_KEY`** on the DigitalOcean App Platform web service (encrypted). If that variable is missing or blank, both endpoints return **503**. The key is not a portal password and it does not start a session.

Send it on every request:

```http
Authorization: Bearer <PHOTO_INGEST_KEY>
```

The comparison is constant-time. A missing or wrong token returns **401**.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/projects/:projectIdOrName/photos` | List stored file names so the job can skip files it already sent |
| `POST` | `/api/projects/:projectIdOrName/photos/ingest` | Upload one or many images |

`:projectIdOrName` is the project id **or** the project name, exact match, including spaces. URL-encode the name. Example project name: `MTVH 2026`.

```bash
curl -sS \
  -H "Authorization: Bearer $PHOTO_INGEST_KEY" \
  "https://savillscloudportal.co.uk/api/projects/MTVH%202026/photos"
```

```json
{ "names": ["2245623-Kitchen-1.jpg", "2245623-Lounge-1.jpg"], "count": 2 }
```

`names` are the stored file names. The photo **code** Excel looks up is that name without the extension, the same as a drag-and-drop upload (`635770-Front Door1.jpg` is code `635770-Front Door1`).

## M3Vision file names

An M3Vision zip has one folder per property and a JPG in that folder:

```text
635770-Challice Way Tillman House 16/635770-Front Door1.jpg
635770-Challice Way Tillman House 16/635770-Kitchen Renewal1.jpg
635770-Challice Way Tillman House 16/635770-nullNo Access1.jpg
635770-Challice Way Tillman House 16/635770-nullDamp and mould growth-1.jpg
```

The pool name is the **base filename**. Spaces, hyphens, the letters `null`, and capitals stay as they are. A folder path in the upload is ignored, so the property folder is not part of the photo code or the Spaces key.

The stem is stored the same way as a Photos Pool drag-and-drop upload. The extension is lower case, and `.jpeg` is saved as `.jpg`, so a `.jpg` from M3Vision stays `.jpg`. The Spaces object key keeps the space as a space (`photos/{projectId}/pool/635770-Front Door1.jpg`). The thumbnail URL and the Excel by-code URL percent-encode that space. Compare names without regard to case, and treat `.jpeg` and `.jpg` as the same photo, when you pre-filter.

## Upload

Send `multipart/form-data`. Repeat the field `files` (or send one file as `file`). Accepted types: JPEG, PNG, WebP, HEIC, HEIF. Each file can be up to **50 MB**. One request can include up to **40** files.

A morning run is about 60 to 500 JPGs, about 2 MB each. Send them in batches of **20** (about 50 MB per request). The JSON body parser is 2 MB and does not apply to these uploads. The server allows 600 seconds for the request, which covers that batch.

A name that already exists in that project's Photos Pool is **skipped**. The stored object is not replaced. Two files in the same request that share a stem are the same: the first is stored, the second is skipped.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $PHOTO_INGEST_KEY" \
  -F "files=@/home/photos/in/2245623-Kitchen-1.jpg" \
  -F "files=@/home/photos/in/2245623-Lounge-1.JPEG" \
  "https://savillscloudportal.co.uk/api/projects/MTVH%202026/photos/ingest"
```

```json
{
  "uploaded": ["2245623-Kitchen-1.jpg", "2245623-Lounge-1.JPEG"],
  "skipped": [],
  "failed": []
}
```

`uploaded` and `skipped` use the filename you sent. `failed` is `{ "name", "error" }` for a file that was rejected (wrong type, empty, or storage error). The HTTP status is **200** when the batch was processed, including when some files failed. **404** means the project id or exact name was not found. **413** means a file was over 50 MB or the request had more than 40 files. **503** means `PHOTO_INGEST_KEY` is unset, or Spaces is not configured.

## Python client

`scripts/photo-ingest.py` uses the Python standard library. It reads a folder or a zip, keeps only image files, drops the property-folder path, fetches the names already stored, and uploads the missing ones in batches of 20 with retries.

```bash
export PHOTO_INGEST_KEY="the-key-from-app-platform"
python3 scripts/photo-ingest.py \
  --base-url https://savillscloudportal.co.uk \
  --project "MTVH 2026" \
  /home/photos/m3vision.zip
```

Stdout is one JSON object:

```json
{ "uploaded": ["635770-Front Door1.jpg"], "skipped": ["635770-Kitchen Renewal1.jpg"], "failed": [] }
```

Progress is printed on stderr. The process exits 0 when `failed` is empty. Do not put the key in the URL or on the command line.
