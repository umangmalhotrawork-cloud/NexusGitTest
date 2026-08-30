# Database Target

This component represents the managed PostgreSQL database dependency for the NEXUS full-stack test fixture.

## Wiring Information
- **Provided Output**: `connectionString`
- **Destination**: Injected as `DATABASE_URL` into `backend`
- **Provisioning Strategy**: Managed PostgreSQL target (simulated during local validation)
