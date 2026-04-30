# Reap: Dashboard (`website`)

The internal monitoring and visualization portal for the Reap trading desk.

## Overview
`website` is a full-stack application (React/FastAPI) that provides real-time visibility into the system's performance, health, and risk.

## Features
- **Live PnL Streams**: Real-time tracking of realized and unrealized gains.
- **Position Monitor**: Visualizing current inventory and risk exposure across all symbols.
- **System Health**: Heartbeat monitoring for `ems`, `data-ingestion`, and `infrastructure` nodes.
- **Backtest Viewer**: Interface for reviewing and comparing historical performance metrics.

## Tech Stack
- **Frontend**: React.js with Tailwind CSS for high-performance data visualization.
- **Backend**: FastAPI for low-latency websocket streaming and REST APIs.
- **Database**: PostgreSQL for storing historical trade logs and PnL snapshots.

## Usage
Used by operators to oversee the autonomous desk and eventually as a portal for institutional transparency.
