#!/bin/bash

# 🎹 AI Piano Coach — Service Manager
# Usage: ./manage.sh [start|stop|restart|status]

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
BACKEND_DIR="$PROJECT_ROOT/backend"

FE_PORT=3456
BE_PORT=8080

PID_DIR="$PROJECT_ROOT/.pids"
FE_PID_FILE="$PID_DIR/frontend.pid"
BE_PID_FILE="$PID_DIR/backend.pid"

mkdir -p "$PID_DIR"

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

status() {
    local running=0
    if [ -f "$FE_PID_FILE" ] && ps -p $(cat "$FE_PID_FILE") > /dev/null; then
        echo -e "${GREEN}✓ Frontend is running${NC} (PID: $(cat "$FE_PID_FILE"), Port: $FE_PORT)"
        running=1
    else
        echo -e "${RED}✗ Frontend is stopped${NC}"
    fi

    if [ -f "$BE_PID_FILE" ] && ps -p $(cat "$BE_PID_FILE") > /dev/null; then
        echo -e "${GREEN}✓ Backend is running${NC} (PID: $(cat "$BE_PID_FILE"), Port: $BE_PORT)"
        running=1
    else
        echo -e "${RED}✗ Backend is stopped${NC}"
    fi
    if [ $running -eq 1 ]; then
        return 0
    else
        return 1
    fi
}

stop() {
    echo -e "${BLUE}Stopping services...${NC}"
    if [ -f "$FE_PID_FILE" ]; then
        kill $(cat "$FE_PID_FILE") 2>/dev/null && echo "Stopped Frontend" || echo "Frontend already stopped"
        rm "$FE_PID_FILE"
    fi
    if [ -f "$BE_PID_FILE" ]; then
        kill $(cat "$BE_PID_FILE") 2>/dev/null && echo "Stopped Backend" || echo "Backend already stopped"
        rm "$BE_PID_FILE"
    fi
    
    # Cleanup any stray processes on these ports
    fuser -k $FE_PORT/tcp 2>/dev/null
    fuser -k $BE_PORT/tcp 2>/dev/null
}

start() {
    echo -e "${BLUE}Starting services...${NC}"
    
    # Start Frontend
    cd "$PROJECT_ROOT"
    python3 -m http.server $FE_PORT --directory "$FRONTEND_DIR" > /dev/null 2>&1 &
    echo $! > "$FE_PID_FILE"
    echo -e "${GREEN}Frontend started on http://localhost:$FE_PORT${NC}"

    # Start Backend
    cd "$BACKEND_DIR"
    # Load .env if it exists
    if [ -f ".env" ]; then
        export $(grep -v '^#' .env | xargs)
    fi
    python3 -m uvicorn main:app --host 0.0.0.0 --port $BE_PORT > ../backend.log 2>&1 &
    echo $! > "$BE_PID_FILE"
    echo -e "${GREEN}Backend started on http://localhost:$BE_PORT${NC}"
    
    sleep 1
    status
}

case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        stop
        sleep 1
        start
        ;;
    status)
        status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
