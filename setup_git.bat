@echo off
setlocal enabledelayedexpansion
title GitHub Setup; Maldives SLR Dashboard; S1701391

:: -- Log file setup ------------------------------------------------------------
set LOGFILE=%~dp0setup_git_log.txt
echo. > "!LOGFILE!"
echo ============================================================ >> "!LOGFILE!"
echo   GitHub Setup Log >> "!LOGFILE!"
echo   %DATE% %TIME% >> "!LOGFILE!"
echo ============================================================ >> "!LOGFILE!"
echo. >> "!LOGFILE!"

call :LOG "Script started"

:: -- Banner --------------------------------------------------------------------
cls
echo.
echo  ============================================================
echo    GitHub Repository Setup
echo    Maldives Sea Level Rise Dashboard, S1701391
echo    Mohamed Zidane Mahmood ^| April 2026
echo  ============================================================
echo.
echo  A log of all steps will be saved to:
echo    %~dp0setup_git_log.txt
echo.
echo  BEFORE YOU CONTINUE, make sure you have:
echo    [1] Created a NEW EMPTY private repo on GitHub
echo        (no README, no .gitignore, completely empty)
echo    [2] Your GitHub username and repo name ready
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 1: Checking Git installation, echo.
call :LOG "STEP 1: Checking Git"

where git >nul 2>&1
if errorlevel 1 (
    call :LOG "ERROR: Git not found on PATH"
    echo  ERROR: Git is not installed or not on your PATH.
    echo.
    echo  Download Git for Windows from:
    echo    https://git-scm.com/download/win
    echo.
    echo  After installing, close this window and re-run setup_git.bat.
    echo.
    call :FAIL "Git not installed"
)

for /f "tokens=*" %%v in ('git --version 2^>^&1') do (
    set GIT_VER=%%v
    call :LOG "Git version: %%v"
)
echo  Found: !GIT_VER!
echo  [OK] Git is installed.
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 2: GitHub repository URL, echo.
call :LOG "STEP 2: Getting repo URL"

echo  Enter your GitHub repository URL.
echo  Example: https://github.com/YOUR_USERNAME/maldives-slr-dissertation.git
echo.
set /p REPO_URL="  Paste URL here: "

if "!REPO_URL!"=="" (
    call :LOG "ERROR: Empty URL entered"
    echo  ERROR: You must enter a URL.
    call :FAIL "No repo URL"
)

echo !REPO_URL! | findstr /i "github.com" >nul
if errorlevel 1 (
    call :LOG "ERROR: URL missing github.com, got: !REPO_URL!"
    echo  ERROR: That does not look like a GitHub URL.
    echo  Expected: https://github.com/USERNAME/REPO.git
    call :FAIL "Invalid URL"
)

call :LOG "Repo URL: !REPO_URL!"
echo.
echo  URL entered: !REPO_URL!
echo.
set /p CONFIRM="  Is this correct? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    call :LOG "User rejected URL, exiting for correction"
    echo  OK, re-run the script and enter the correct URL.
    pause & exit /b 0
)
echo.

:: -----------------------------------------------------------------------------
echo.
echo , STEP 3: Git identity, echo.
call :LOG "STEP 3: Git identity"

for /f "tokens=*" %%n in ('git config --global user.name 2^>nul') do set GIT_NAME=%%n
for /f "tokens=*" %%e in ('git config --global user.email 2^>nul') do set GIT_EMAIL=%%e

if "!GIT_NAME!"=="" (
    set /p GIT_NAME="  Enter your full name (e.g. Mohamed Zidane Mahmood): "
    if "!GIT_NAME!"=="" ( call :FAIL "No name entered" )
    git config --global user.name "!GIT_NAME!" >> "!LOGFILE!" 2>&1
    call :LOG "Set user.name: !GIT_NAME!"
)

if "!GIT_EMAIL!"=="" (
    set /p GIT_EMAIL="  Enter your email address: "
    if "!GIT_EMAIL!"=="" ( call :FAIL "No email entered" )
    git config --global user.email "!GIT_EMAIL!" >> "!LOGFILE!" 2>&1
    call :LOG "Set user.email: !GIT_EMAIL!"
)

echo.
echo  Git identity confirmed:
echo    Name:  !GIT_NAME!
echo    Email: !GIT_EMAIL!
echo.
set /p CONFIRM="  Is this correct? (Y/N): "
if /i not "!CONFIRM!"=="Y" (
    call :LOG "User rejected identity, clearing and restarting"
    git config --global --unset user.name
    git config --global --unset user.email
    echo  Identity cleared. Re-run the script to enter correct details.
    pause & exit /b 0
)
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 4: Initialising local repository, echo.
call :LOG "STEP 4: git init"

if not exist ".git" (
    echo  Initialising git repository...
    git init >> "!LOGFILE!" 2>&1
    if errorlevel 1 (
        call :LOG "ERROR: git init failed, see log"
        call :FAIL "git init failed"
    )
    git branch -M main >> "!LOGFILE!" 2>&1
    call :LOG "git init OK, branch=main"
    echo  [OK] Repository initialised. Branch set to main.
) else (
    call :LOG "Existing .git found, skipping init"
    echo  Repository already initialised, skipping.
)
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 5: Creating .gitignore, echo.
call :LOG "STEP 5: Writing .gitignore"

(
echo node_modules/
echo *.tar.gz
echo *.zip
echo *.rar
echo __pycache__/
echo .env
echo .DS_Store
echo Thumbs.db
echo *.log
echo .idea/
echo .vscode/
) > .gitignore

if errorlevel 1 (
    call :LOG "ERROR: Failed to write .gitignore"
    call :FAIL ".gitignore write failed"
)
call :LOG ".gitignore written OK"
echo  [OK] .gitignore created.
echo.

:: -----------------------------------------------------------------------------
echo.
echo , STEP 6: Staging files, echo.
call :LOG "STEP 6: git add ."

echo  Staging all project files...
git add . >> "!LOGFILE!" 2>&1
if errorlevel 1 (
    call :LOG "ERROR: git add failed"
    call :FAIL "git add failed"
)

for /f %%c in ('git diff --cached --name-only 2^>nul ^| find /c /v ""') do set STAGED=%%c
call :LOG "Staged: !STAGED! files"
echo  [OK] !STAGED! files staged.
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 7: Creating commit, echo.
call :LOG "STEP 7: git commit"

git commit -m "Initial commit: Maldives SLR dissertation, S1701391 April 2026" >> "!LOGFILE!" 2>&1

if errorlevel 1 (
    :: May fail if nothing new to commit (already committed previously)
    for /f "tokens=*" %%s in ('git status --porcelain 2^>nul') do set GIT_DIRTY=%%s
    if "!GIT_DIRTY!"=="" (
        call :LOG "Nothing new to commit, previous commit exists, continuing"
        echo  No new changes to commit (already committed). Continuing to push.
    ) else (
        call :LOG "ERROR: git commit failed with dirty tree"
        call :FAIL "git commit failed"
    )
) else (
    call :LOG "Commit created OK"
    echo  [OK] Commit created.
)
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 8: Setting remote origin, echo.
call :LOG "STEP 8: git remote add origin"

git remote remove origin >nul 2>&1
git remote add origin !REPO_URL! >> "!LOGFILE!" 2>&1
if errorlevel 1 (
    call :LOG "ERROR: git remote add failed"
    call :FAIL "git remote add failed"
)

:: Verify it was set
for /f "tokens=*" %%r in ('git remote get-url origin 2^>nul') do set REMOTE_CHECK=%%r
call :LOG "Remote verified: !REMOTE_CHECK!"
echo  [OK] Remote origin: !REMOTE_CHECK!
echo.
pause

:: -----------------------------------------------------------------------------
echo.
echo , STEP 9: Pushing to GitHub, echo.
call :LOG "STEP 9: git push"

echo  Pushing to GitHub now...
echo  If a login window appears, sign in with your GitHub account.
echo  If asked for a password in the terminal, use a Personal Access Token.
echo  (instructions shown below if it fails)
echo.

git push -u origin main >> "!LOGFILE!" 2>&1

if errorlevel 1 (
    call :LOG "ERROR: git push failed"
    echo.
    echo  ============================================================
    echo   PUSH FAILED
    echo  ============================================================
    echo.
    echo  GitHub does not accept passwords anymore.
    echo  You must authenticate using one of these methods:
    echo.
    echo  OPTION A, Personal Access Token (recommended):
    echo.
    echo    1. Go to: https://github.com/settings/tokens
    echo    2. Click "Generate new token (classic)"
    echo    3. Name it anything, set expiry 90 days
    echo    4. Tick the "repo" checkbox
    echo    5. Click "Generate Token" at the bottom
    echo    6. COPY the token shown (starts with ghp_...)
    echo       WARNING: you can only see it once
    echo    7. Open a new Command Prompt in this folder and run:
    echo         git push -u origin main
    echo       Username: your GitHub username
    echo       Password: paste the ghp_... token ^(not your password^)
    echo.
    echo  OPTION B, GitHub CLI:
    echo.
    echo    1. Download from: https://cli.github.com
    echo    2. Install and then run:  gh auth login
    echo    3. Choose HTTPS and follow browser prompts
    echo    4. Then run:  git push -u origin main
    echo.
    echo  Full error details in:
    echo    !LOGFILE!
    echo  ============================================================
    echo.
    pause & exit /b 1
)

call :LOG "Push SUCCESS"

:: -----------------------------------------------------------------------------
echo.
echo  ============================================================
echo   SUCCESS
echo   Repository pushed to: !REPO_URL!
echo  ============================================================
echo.
echo  What to do next:
echo    1. Open the URL above in your browser
echo       and confirm all files are there
echo    2. GitHub repo Settings ^> Collaborators
echo       ^> Add your supervisor's GitHub username
echo    3. Copy the repo URL into your dissertation
echo       submission form
echo.
echo  Full setup log saved to:
echo    !LOGFILE!
echo.
call :LOG "SETUP COMPLETE, SUCCESS"
pause
exit /b 0

:: -----------------------------------------------------------------------------
:LOG
echo [%TIME%] %~1 >> "!LOGFILE!"
exit /b 0

:FAIL
echo. >> "!LOGFILE!"
echo [%TIME%] FAILED: %~1 >> "!LOGFILE!"
echo. >> "!LOGFILE!"
echo ============================================================
echo  SETUP FAILED AT: %~1
echo  Full error log: !LOGFILE!
echo  Open that file and share it if you need help.
echo ============================================================
echo.
pause
exit /b 1
