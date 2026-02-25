# Campus Attendance Dedicated API

A standalone Node.js + Express backend for the Campus Attendance Web App. This API is completely independent of the Telegram bot and designed for easy deployment to Railway.

## 🚀 Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) or [Bun](https://bun.sh/)

### 2. Installation
Navigate to the backend folder and install dependencies:
```bash
# Using npm
npm install

# Using bun (recommended for your environment)
bun install
```

### 3. Running Locally
```bash
# Using npm
npm start

# Using bun
bun run server.js
```
The API will be available at `http://localhost:8080`.

### 🧪 Test Credentials
- **Email**: `test@test.com`
- **Password**: `1234`

## 🚂 Railway Deployment

1. **New Project**: Go to [Railway](https://railway.app/) and create a new project.
2. **Repository**: Select your GitHub repository.
3. **Root Directory**: Set the "Root Directory" to `backend` in the Railway service settings.
4. **Environment Variables**: Add a `JWT_SECRET` variable in the Railway "Variables" tab. (Railway will automatically provide the `PORT`).
5. **Deploy**: Railway will detect the `package.json` and run `npm start` automatically.

## 📁 API Endpoints
- `GET /` - Health check
- `POST /login` - Mock login
- `GET /validate-token` - Token verification
- `GET /classes` - Get class list
- `GET /subjects` - Get subjects
- `GET /students` - Get students
- `POST /mark-attendance` - Submit records
