from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/gacha"
    cors_origins: list[str] = ["http://localhost:3000"]
    pg_provider: str = "fake"  # "fake" | "portone" — 실 키 발급 전까지 fake
    admin_api_key: str = "dev-admin-key"  # TODO(F-01): 어드민 계정/권한으로 교체. 배포 전 .env 필수


settings = Settings()
