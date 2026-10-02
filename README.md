# Power Music MVP

This project is a web application featuring a React/Vite frontend and a FastAPI (Python) backend. The current state reflects **Pilot 1: Data Entry Automation**, allowing administrators to manage personnel requests and review the directory of added individuals.

## Project Structure

```text
root/
├── frontend/               # React + Vite Frontend Application
│   ├── src/                # React source code (components, pages, utils)
│   ├── public/             # Static assets
│   ├── index.html          # Main HTML template
│   ├── package.json        # Node dependencies and scripts
│   └── tailwind.config.js  # TailwindCSS styling configuration
│
└── backend/                # FastAPI Python Backend Application
    ├── app/                # Main application package
    │   ├── api/            # API endpoints and routers (e.g., pilot1.py)
    │   ├── main.py         # FastAPI application entry point
    │   ├── database.py     # Database connection setup
    │   ├── models.py       # SQLAlchemy ORM models
    │   └── schemas.py      # Pydantic validation schemas
    ├── alembic/            # Database migration scripts
    ├── tests/              # Pytest test suite
    ├── requirements.txt    # Python dependencies
    └── .env                # Environment variables (Database URL)
```

## Running the Application

### 1. Frontend (React)

You need [Node.js](https://nodejs.org/) installed to run the frontend.

1. Open a terminal and navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install the dependencies (only needed the first time):
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. The application will be available at `http://localhost:5173`.

### 2. Backend (FastAPI)

You need Python 3.9+ installed to run the backend.

1. Open a terminal and navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a virtual environment (recommended):
   ```bash
   # Windows
   python -m venv venv
   .\venv\Scripts\activate

   # macOS/Linux
   python3 -m venv venv
   source venv/bin/activate
   ```
3. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the Uvicorn server. **Note:** Ensure you run it from the root of the `backend` folder and point to the `app` package:
   ```bash
   uvicorn app.main:app --reload
   ```
5. The API will be available at `http://localhost:8000`.
6. Visit `http://localhost:8000/docs` to view the interactive Swagger API documentation.

### Database

The backend connects to a remote Supabase PostgreSQL database. Make sure your `backend/.env` file is properly populated with the `DATABASE_URL`.

### Frontend Global Flag

Configuration File: `frontend/src/config.js`

Flag: `export const ENFORCE_DOMAIN_CHECK = true;`

Behavior: Setting this to false disables the email domain validations in both the Manager Form (ManagerForm.jsx) and the Signup view (Signup.jsx).
