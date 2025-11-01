# 🧩 GameHub – Dots & Boxes Platform (Phase 1)

### 📘 Project Overview
**GameHub** is part of the **DashandDots Games Platform**, a web-based multiplayer system built to support multiple turn-based games.  
The first implementation focuses on **Dots & Boxes**, with real-time online play.

---

## 🚀 Phase 1 – Environment & Architecture Setup

### ✅ Completed Goals
- **Monorepo structure** using **Turborepo** and **pnpm workspaces**
- **Frontend:** Next.js + TypeScript
- **Backend:** Fastify (Node.js) server with TypeScript
- **Database:** PostgreSQL via Docker
- **Cache:** Redis via Docker
- **WSL Ubuntu** development environment (Linux setup on Windows)
- **Cross-platform support:** Project runs on both WSL and Windows directly

---

## 🧱 Project Structure
```
GameHub/
├── apps/
│   ├── web/                # Next.js frontend
│   └── server/             # Fastify backend
├── packages/
│   └── shared/             # (upcoming) shared types & game logic
├── docker-compose.yml      # Postgres + Redis containers
├── turbo.json              # Turborepo task configuration
├── pnpm-workspace.yaml     # Workspace configuration
├── .env                    # Environment variables (local)
└── Step-1_Setup.md         # Detailed setup log
```

---

## ⚙️ Tech Stack
| Layer | Technology | Purpose |
|-------|-------------|----------|
| Frontend | **Next.js (React + TS)** | UI & gameplay rendering |
| Backend | **Fastify (Node.js)** | Game API & socket handling |
| Database | **PostgreSQL (Docker)** | Persistent user/game data |
| Cache | **Redis (Docker)** | Real-time game state |
| Monorepo | **Turborepo + pnpm** | Multi-app workspace management |
| Language | **TypeScript** | Type safety & shared definitions |

---

## 🧩 Running Locally
**Start backend services:**
```bash
docker compose up -d
```

**Run web & server apps together:**
```bash
pnpm install
pnpm dev
```

**Endpoints:**
- Web → http://localhost:3000  
- API health → http://localhost:4001/health

---

## 🧰 Environment Variables
Create a `.env` file in the root:
```
PORT=4001
DATABASE_URL="postgresql://dd_user:dd_pass@localhost:5432/dashanddots?schema=public"
REDIS_URL="redis://localhost:6379"
```

---

## 🪜 Next Phase (Step 2 – Core System)
- Add `packages/shared` for game types and logic  
- Implement `game-registry.ts` for modular game loading  
- Build Dots & Boxes engine (state, validation, move logic)  
- Integrate real-time socket events between web & server  
- Persist matches to PostgreSQL  

---

### 📅 Current Progress
✅ **Phase 1 – Environment & Scaffolding** complete  
🔜 **Phase 2 – Core Game Logic & Real-time Engine**

---

*Maintainer: BeAkash*  
*Last updated: November 2025*
