# NEXUS Full-Stack Deployment Test Project

This is a controlled, deterministic full-stack fixture designed specifically for validating NEXUS Deployment Intelligence and Phase 4D multi-stage orchestration.

## Topology
- **Frontend**: Vite + React single-page application located in `frontend/`
- **Backend**: Express REST API located in `backend/` with health route at `GET /api/health`
- **Database**: PostgreSQL target dependency referenced via `DATABASE_URL`

## Architecture & Dependency Wiring
```
Frontend (Vite)
   ↓ [VITE_API_URL]
Backend (Express)
   ↓ [DATABASE_URL]
PostgreSQL Database
```

## Security & Safety Note
This fixture contains zero real credentials, zero API keys, zero cloud access tokens, and zero active database connections. It is intended purely for local deterministic inspection and orchestration contract testing.
