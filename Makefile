.PHONY: build frontend backend clean install install-python install-node

build: frontend

frontend:
	npm run build

backend:
	# Python modules don't need building, but validate imports
	python3 -c "from backend import consts, steam, games, app_config; print('Backend imports OK')"

clean:
	rm -rf dist/ node_modules/ .venv/ __pycache__/ */__pycache__/ */*/__pycache__/

install: install-python install-node

install-python:
	pip install -e ".[dev]"

install-node:
	npm install

test:
	python3 -m pytest tests/ -v

fmt:
	black --quiet backend/ tests/ main.py 2>/dev/null || true
	npx prettier --write src/ 2>/dev/null || true

lint:
	python3 -m pylint backend/ main.py 2>/dev/null || true
