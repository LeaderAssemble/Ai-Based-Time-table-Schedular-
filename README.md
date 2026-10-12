# AI Powered Timetable Scheduler

## Live demo

Open the deployed web demo: <https://timetable-scheduler-pro.onrender.com>

The hosted demo uses fictional sample data in a separate database. Do not enter real student or staff information. Render's free filesystem can reset data after a restart or redeploy.

## Run locally

Clone this repository:

```powershell
git clone https://github.com/LeaderAssemble/Ai-Based-Time-table-Schedular-.git
cd Ai-Based-Time-table-Schedular-
```

The Windows local web launcher is [`web-demo/run-local.bat`](./web-demo/run-local.bat). It uses the existing `timetable_db.sqlite3` database in the repository root and asks you to set a local password. Start the launcher, then open <http://127.0.0.1:8000> (also known as `http://localhost:8000`) on the same computer. This address works only while the local server is running.

See the [web demo guide](./web-demo/README.md) for local and hosted-demo details.

## Project overview

The AI Powered Timetable Scheduler generates and manages class timetables, helping avoid scheduling conflicts between classes, teachers, and rooms.

## Features

- Generates conflict-aware timetables
- Manages subjects, teachers, classes, and rooms
- Supports timetable history and workload analytics
- Provides a browser-based interface and a desktop application

## Technologies

- Python
- HTML, CSS, and JavaScript
- Local timetable scheduling logic

## Author

Aniket Singh Yadav
