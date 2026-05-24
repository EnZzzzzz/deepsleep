PID_FILE = .deepsleep/server.pid
LOG_FILE = .deepsleep/server.log
PORT ?= 3000

.PHONY: start stop logs status restart

start:
	@mkdir -p $(dir $(PID_FILE))
	@nohup node main.js > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@echo "[deepsleep] server started on ws://localhost:$(PORT) (pid: $$(cat $(PID_FILE)))"

stop:
	@if [ -f $(PID_FILE) ]; then \
		kill $$(cat $(PID_FILE)) 2>/dev/null && \
		echo "[deepsleep] server stopped (pid: $$(cat $(PID_FILE)))" || \
		echo "[deepsleep] server not running"; \
		rm -f $(PID_FILE); \
	else \
		echo "[deepsleep] no pid file found"; \
	fi

logs:
	@if [ -f $(LOG_FILE) ]; then \
		tail -f $(LOG_FILE); \
	else \
		echo "[deepsleep] no log file found"; \
	fi

status:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		echo "[deepsleep] server running (pid: $$(cat $(PID_FILE)))"; \
	else \
		echo "[deepsleep] server not running"; \
	fi

restart: stop start
