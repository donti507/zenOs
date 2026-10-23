# Deployment

This project builds a Vite React client and bundles an Express `server.ts` with `esbuild`.

Local Docker build and run:

```bash
# build image
docker build -t zenos-core:latest .

# run with your .env (LLM_*, SUPABASE_URL, SUPABASE_ANON_KEY …)
docker run -p 3000:3000 --env-file .env zenos-core:latest
```

GitHub Container Registry (GHCR):

- On push to `main` the included GitHub Actions workflow `/.github/workflows/docker-publish.yml` will build and push images to `ghcr.io/<owner>/<repo>`.
- To deploy to a host (Render, Fly, Docker, etc.) use the pushed image `ghcr.io/<owner>/<repo>:latest`.

Render (example):

1. Create a new Web Service on Render and choose "Docker".
2. For the image registry use `ghcr.io` and set the image to `ghcr.io/<owner>/<repo>:latest`.
3. Add the environment variables from `.env.example` (`LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`) in the Render dashboard.
4. Start the service and Render will pull the container.

The server must be served over **HTTPS** for voice input to work in browsers.
