# Typing Game Agent Workflow

## Purpose

This repository must use a **local -> GitHub -> server** workflow.

- Always sync the latest code from **GitHub** to the current local environment first.
- Make all code changes **locally**.
- Push local commits to **GitHub**.
- Update the **server** from GitHub.
- Do **not** treat the server as the source of truth.
- Do **not** edit production files directly on the server unless it is an emergency recovery, and if that ever happens, sync those changes back into GitHub immediately.

## Source of Truth

The source of truth is:

1. Local working copy synced from GitHub
2. GitHub repository
3. Server deployment updated from GitHub

The local path may differ between machines. If the expected local folder does not exist, clone the repository from GitHub to a suitable local path first.

## Repository and Server Information

### GitHub

- Repository HTTPS URL: `https://github.com/zhanghaoduan/-typing-game.git`
- Repository SSH URL: `git@github.com:zhanghaoduan/-typing-game.git`
- Default branch: `main`

### Common local path on this Windows machine

- `C:\Users\yujunzhang\typing-game`

### Production server

- SSH alias: `zhd`
- SSH user/host: `azureuser@www.zhanghaoduan.cn` via local SSH config alias `zhd`
- Web root / git working tree: `/var/www/html`
- Node server directory: `/var/www/html/server`
- PM2 app name: `typing-game`

## Required Workflow

### 1. Prepare or locate the local repository

If the repository already exists locally:

```powershell
Set-Location 'C:\path\to\typing-game'
git remote -v
git status --short --branch
git fetch origin
git switch main
git pull --ff-only origin main
```

If the repository does not exist locally yet:

```powershell
Set-Location 'C:\path\to\parent'
git clone https://github.com/zhanghaoduan/-typing-game.git typing-game
Set-Location '.\typing-game'
git switch main
```

### 2. Make changes locally

- Edit code only in the local repository.
- Run the relevant local checks before pushing.
- Review changes before commit.

Typical commands:

```powershell
git status --short
git diff --stat
```

### 3. Commit and push to GitHub

```powershell
git add -A
git commit -m "Describe the change"
git push origin main
```

### 4. Update the production server from GitHub

```powershell
ssh zhd "cd /var/www/html && git fetch origin && git switch main && git pull --ff-only origin main"
```

If server dependencies changed:

```powershell
ssh zhd "cd /var/www/html/server && npm install"
```

Restart the service after deployment:

```powershell
ssh zhd "pm2 restart typing-game"
```

## Verification Commands

### Check local commit

```powershell
Set-Location 'C:\path\to\typing-game'
git rev-parse HEAD
```

### Check server commit

```powershell
ssh zhd "cd /var/www/html && git rev-parse HEAD"
```

After a normal deployment, local `HEAD`, GitHub `origin/main`, and server `HEAD` should match.

Useful comparison commands:

```powershell
Set-Location 'C:\path\to\typing-game'
git fetch origin
git rev-parse HEAD
git rev-parse origin/main
```

```powershell
ssh zhd "cd /var/www/html && git rev-parse HEAD && git status --short --branch"
```

## Rules for Copilot and Human Operators

1. Never deploy by manually copying old local files over a newer server checkout.
2. Never make server-only feature changes and leave them uncommitted.
3. Before starting work in any environment, sync from GitHub first.
4. Before updating the server, ensure local changes are already pushed to GitHub.
5. If the server ever becomes newer than local, stop and reconcile the difference before the next deployment.

## Recovery Rule

If local and server are inconsistent:

1. Check both commits:
   - local: `git rev-parse HEAD`
   - server: `ssh zhd "cd /var/www/html && git rev-parse HEAD"`
2. If the server has unpushed changes, preserve them first by committing/pushing from the correct repository or copying the changes back into a local branch.
3. Re-establish GitHub `main` as the shared baseline.
4. Only then continue normal development.

## Recommended Startup Checklist for Agents

When starting work in any environment:

1. Locate the repository.
2. Confirm the git remote is `zhanghaoduan/-typing-game`.
3. Run `git fetch origin`.
4. Switch to `main`.
5. Run `git pull --ff-only origin main`.
6. Inspect `git status --short --branch`.
7. Make changes locally only.
8. Push to GitHub before touching the server.
9. Update the server from GitHub.

## Current Warning

On 2026-06-21, local and server were observed to be out of sync, with the server ahead of the current local checkout. Until that reconciliation is completed, do not assume the local working tree is the newest version without checking Git history first.
