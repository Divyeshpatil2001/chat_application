# Chat App (Node + React)

One-to-one and group chat with real-time messaging, media sharing, edit/delete.

- **server/**: Node, Express (REST), Socket.IO (real time), JWT auth, bcrypt, SQLite (`node:sqlite`), multer
- **client/**: React + Vite, socket.io-client
- **MinIO**: S3-compatible storage for photos and videos

## Run with Docker (recommended)

```bash
docker compose up --build
```

| What | URL |
|---|---|
| App | http://localhost:5173 |
| API | http://localhost:4000 |
| MinIO console | http://localhost:9001 (login `chatminio` / `chatminiosecret`) |

Code changes hot-reload in both containers. Data survives `docker compose down`: the database
is in the `chat_server_data` volume and media is in `chat_minio_data`.
`docker compose down -v` deletes both volumes and starts you from scratch.

## Run without Docker

```bash
cd server && npm install && npm run dev     # http://localhost:4000
cd client && npm install && npm run dev     # http://localhost:5173
```

Media goes to `server/uploads` and the database to `server/chat.db`. To use MinIO instead, see
`server/.env.example`.

## Where data is stored

| Data | Storage |
|---|---|
| Users, chats, messages | SQLite file `chat.db`. Every write is committed immediately. |
| Photos/videos | MinIO bucket `chat-media` (Docker) or `server/uploads` (local) |
| Login token | Browser `localStorage` |

A message only stores the media URL. The file itself is in MinIO.

## Features
- Register / log in
- One-to-one chats from the **People** tab, groups with **+ Group**, add people, leave group
- Live messages, online status, typing indicator, unread counts
- Photo/video upload (📎), full-screen preview with download
- Edit your own messages; delete for me / for everyone; delete chat (for me)
- Close chat (←)

## Note on the MinIO image
The official `minio/minio` and `minio/mc` images were removed from Docker Hub, and quay.io now
refuses anonymous pulls. This project uses `pgsty/minio` and `pgsty/mc`, which are community
builds of the same MinIO source, pinned to a release tag.
