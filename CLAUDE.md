# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Automaker is an autonomous AI development studio - a Kanban-based application where users describe features and AI agents (powered by Claude Agent SDK) automatically implement them. It runs as an Electron desktop app or in web browser mode.

## Commands

```bash
# Install dependencies
npm install

# Build shared packages (REQUIRED before running)
npm run build:packages

# Development
npm run dev               # Interactive mode selector
npm run dev:electron      # Electron desktop app
npm run dev:web           # Web browser mode (localhost:3007)
npm run dev:server        # Backend server only

# Testing
npm run test              # UI E2E tests (Playwright)
npm run test:headed       # UI tests with visible browser
npm run test:server       # Server unit tests (Vitest)
npm run test:packages     # Shared package tests

# Linting & Formatting
npm run lint              # ESLint
npm run format            # Prettier
npm run format:check      # Check formatting

# Building
npm run build             # Build Next.js app
npm run build:electron    # Build Electron distribution
```

## Architecture

### Monorepo Structure (npm workspaces)

```
apps/
├── ui/          # Electron + Vite + React frontend (@automaker/ui)
└── server/      # Express + WebSocket backend (@automaker/server)

libs/            # Shared packages (@automaker/*)
├── types/       # Shared TypeScript interfaces
├── utils/       # Common utilities
├── prompts/     # AI prompt templates
├── platform/    # Platform-specific code (paths, security)
├── git-utils/   # Git operations
├── model-resolver/    # AI model configuration
└── dependency-resolver/ # Dependency management
```

### Key Patterns

**State Management (UI)**: Zustand stores in `apps/ui/src/store/`

- `app-store.ts` - Main application state (features, settings, themes)
- `setup-store.ts` - Project setup wizard state

**Routing (UI)**: TanStack Router with file-based routes in `apps/ui/src/routes/`

**Backend Services**: Express + WebSocket in `apps/server/src/`

- Services in `/services/` handle business logic
- Routes in `/routes/` define API endpoints
- Providers in `/providers/` abstract AI model integrations

**Provider Architecture**: Model-based routing via `ProviderFactory`

- `ClaudeProvider` wraps @anthropic-ai/claude-agent-sdk
- Designed for easy addition of other providers

**Feature Storage**: Features stored in `.automaker/features/{id}/feature.json`

**Communication**:

- Electron: IPC via preload script (`apps/ui/src/preload.ts`)
- Web: HTTP API client (`apps/ui/src/lib/http-api-client.ts`)

### Important Files

- `apps/ui/src/main.ts` - Electron main process
- `apps/server/src/index.ts` - Server entry point
- `apps/ui/src/lib/electron.ts` - IPC type definitions
- `apps/server/src/services/agent-service.ts` - AI agent session management
- `apps/server/src/providers/provider-factory.ts` - Model routing

## Development Notes

- Always run `npm run build:packages` after modifying any `libs/*` package
- Server runs on port 3008 by default
- UI runs on port 3007 in web mode
- Authentication: Set `ANTHROPIC_API_KEY` env var or configure via Settings
