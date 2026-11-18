---
name: Terminal basics
when: ["terminal", "what does this command mean", "how do i stop the server", "ctrl c", "cd", "ls", "git status", "i am lost in terminal", "терминал", "что значит команда", "как остановить сервер", "я потерялся в терминале"]
escalate_if: ["the Terminal asks for a password you did not expect", "the Terminal shows a command you do not understand and it would delete something"]
risk: low
version: 1
---
# Terminal basics

The Terminal is a window where you type commands. You do not need to learn everything. These few moves cover our routine.

## Steps

### 1. Open Terminal
Do: Press Cmd+Space, type Terminal, press Enter.
Why: This is the window where the commands of every other skill are typed.
Check: You see a window with a line ending in % or $.
Ack: yes

### 2. Ask "where am I?"
Do: Type the command and press Enter.
Command: `pwd`
Why: pwd shows the folder you are in. Commands act on this folder.
Check: It prints a path like /Users/<you>/... or /Volumes/Agent/...
Expect: /^\//m

### 3. Look at what is here
Do: Type the command and press Enter.
Command: `ls`
Why: ls lists the files and folders in the current folder. `ls -la` also shows hidden ones.
Check: You see names. In the repo folder you should see bakugan-buddy.
Expect: /bakugan-buddy/
Fail-hint: Not in the repo folder? Use cd to go there (next step).

### 4. Move to another folder
Do: Type cd, a space, and the folder path. Tip: type the first letters and press Tab, the Terminal completes the name. If a path has spaces, put it in quotes.
Command: `cd <repo>`
Command: `cd ..`
Why: cd means "change directory". `cd ..` goes one folder up.
Check: Run pwd again. It shows the folder you wanted.
Expect: /^\//m

### 5. Ask Git how things are
Do: Inside the repo folder run the command.
Command: `git status`
Why: It shows the branch you are on and whether files are changed. "working tree clean" means nothing is changed.
Check: The first line starts with "On branch".
Expect: /^On branch /m

### 6. Stop a program that keeps running
Do: Click the Terminal window and press Ctrl+C (the Control key, not Cmd).
Why: Servers keep the window busy until you stop them. Ctrl+C sends "please stop". In the Terminal, Cmd+C copies text, but Ctrl+C stops the program.
Check: The prompt (% or $) comes back and you can type again.
Expect: /\^C|%|\$/
Fail-hint: Still stuck? Press Ctrl+C once more. If a screen full of text with a ":" at the bottom is open (git log or git diff), press q to leave it.

## Checks
- You can say where you are (pwd), what is here (ls), how to move (cd), the repo state (git status), and how to stop a program (Ctrl+C).

## Common mistakes
- Pressing Cmd+C to stop a program (that is copy). Use Ctrl+C.
- Typing a command in the wrong folder. Run pwd first.
- Pasting a command you do not understand. Ask the coach what it means before pressing Enter.

## Glossary
- pwd: print working directory, shows the current folder.
- ls: list the files in this folder.
- cd: change directory, move to another folder.
- cd ..: go up one folder.
- git status: show the branch and any changed files.
- Ctrl+C: stop the running program.
- q: leave a text viewer such as git log.
- Tab: complete a file or folder name for you.
- sudo: run a command as administrator. The coach never asks you to use it. If a skill ever does, stop and ask.
