# production-retail-and-wholesale

Supports production, sales, billing and inventory management.

See `AGENTS.md` for the implementation plan, provisioning details and contribution guidelines.

## API Documentation & Swagger UI

API documentation is available via Swagger UI. The OpenAPI specification is generated from JSDoc comments in `server/index.js`.

A pre-commit hook is configured to automatically generate or update the `tools/openapi-spec.json` file whenever changes to `server/index.js` are committed. This ensures the specification is always up-to-date with the code.

To view the Swagger UI locally:

1.  **Ensure the specification is generated:**
    If you haven't made a commit yet or want to manually regenerate:
    ```bash
    npm run generate-spec
    ```
    Alternatively, committing any change to `server/index.js` will trigger the pre-commit hook.

2.  **Start the main API server:**
    This server runs the actual API endpoints.
    ```bash
    cd server
    npm start
    ```
    This usually runs on `http://localhost:3000`.

3.  **Start the Swagger UI server:**
    In a separate terminal, run:
    ```bash
    npm run start:swagger
    ```
    This server is dedicated to serving the Swagger UI and typically runs on `http://localhost:3001`.

4.  **Access the UI:**
    Open your browser and navigate to `http://localhost:3001/docs`.
