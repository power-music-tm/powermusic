"""
One-time admin bootstrap for local/dev or manual production setup.

Never run on deploy. In production, ADMIN_EMAIL and ADMIN_PASSWORD are required.
Password rotation: Supabase Dashboard or auth.admin.updateUserById — not this script.
"""
import os
import sys
import uuid
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

DEV_DEFAULT_EMAIL = "andrea@powermusic.com"
DEV_DEFAULT_PASSWORD = "AndreaSuperSecurePass2026!"


def is_production() -> bool:
    return os.getenv("VERCEL_ENV") == "production" or os.getenv("ENVIRONMENT") == "production"


def resolve_admin_credentials():
    email = os.getenv("ADMIN_EMAIL")
    password = os.getenv("ADMIN_PASSWORD")

    if is_production():
        if not email or not password:
            print(
                "Error: production seed requires ADMIN_EMAIL and ADMIN_PASSWORD. "
                "Run manually with secrets — never on deploy.",
                file=sys.stderr,
            )
            sys.exit(1)
        return email, password

    if not email or not password:
        print(
            "WARNING: DEV ONLY — using default admin credentials. "
            "Set ADMIN_EMAIL and ADMIN_PASSWORD for production.",
            file=sys.stderr,
        )
        return email or DEV_DEFAULT_EMAIL, password or DEV_DEFAULT_PASSWORD

    return email, password


def main():
    load_dotenv(dotenv_path=".env")
    load_dotenv(dotenv_path="backend/.env")

    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        print("Error: DATABASE_URL is not set.", file=sys.stderr)
        sys.exit(1)

    admin_email, admin_password = resolve_admin_credentials()
    admin_full_name = os.getenv("ADMIN_FULL_NAME", "Power Music Admin")
    force_password_reset = os.getenv("ADMIN_FORCE_PASSWORD_RESET", "").lower() in {
        "1",
        "true",
        "yes",
    }

    if db_url.startswith("postgresql://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg://", 1)
    elif db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg://", 1)

    print(f"Connecting to database to seed admin '{admin_email}'...")
    try:
        engine = create_engine(db_url)
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS pgcrypto;"))

            existing_admin = conn.execute(
                text(
                    """
                    SELECT p.id, u.email
                    FROM public.powermusic_users p
                    JOIN auth.users u ON u.id = p.id
                    WHERE p.role = 'admin'
                    LIMIT 1
                    """
                )
            ).fetchone()

            if existing_admin:
                print(
                    f"Admin already exists: {existing_admin.email} ({existing_admin.id}). "
                    "No changes made."
                )
                if force_password_reset:
                    conn.execute(
                        text(
                            """
                            UPDATE auth.users
                            SET encrypted_password = crypt(:password, gen_salt('bf', 10)),
                                updated_at = now()
                            WHERE id = :id
                            """
                        ),
                        {"password": admin_password, "id": existing_admin.id},
                    )
                    print("Password updated (ADMIN_FORCE_PASSWORD_RESET was set).")
                else:
                    print(
                        "To rotate the password, use Supabase Dashboard or set "
                        "ADMIN_FORCE_PASSWORD_RESET=1 for a one-off reset."
                    )
                return

            existing_user = conn.execute(
                text("SELECT id FROM auth.users WHERE email = :email"),
                {"email": admin_email},
            ).fetchone()

            if existing_user:
                user_id = existing_user[0]
                print(f"User '{admin_email}' exists — promoting to admin profile.")
            else:
                user_id = str(uuid.uuid4())
                print(f"Creating admin user {user_id}...")
                conn.execute(
                    text(
                        """
                        INSERT INTO auth.users (
                            instance_id, id, aud, role, email, encrypted_password,
                            email_confirmed_at, recovery_sent_at, last_sign_in_at,
                            raw_app_meta_data, raw_user_meta_data,
                            created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new,
                            recovery_token, is_super_admin, is_anonymous
                        ) VALUES (
                            '00000000-0000-0000-0000-000000000000',
                            :id, 'authenticated', 'authenticated', :email,
                            crypt(:password, gen_salt('bf', 10)),
                            now(), now(), now(),
                            '{"provider": "email", "providers": ["email"]}',
                            :user_meta,
                            now(), now(),
                            '', '', '', '', false, false
                        )
                        """
                    ),
                    {
                        "id": user_id,
                        "email": admin_email,
                        "password": admin_password,
                        "user_meta": (
                            f'{{"firstName": "{admin_full_name}", '
                            f'"full_name": "{admin_full_name}", "role": "admin"}}'
                        ),
                    },
                )
                conn.execute(
                    text(
                        """
                        INSERT INTO auth.identities (
                            id, user_id, identity_data, provider, provider_id,
                            last_sign_in_at, created_at, updated_at
                        ) VALUES (
                            gen_random_uuid(),
                            CAST(:user_id AS uuid),
                            json_build_object(
                                'sub', CAST(:user_id AS text),
                                'email', CAST(:email AS text)
                            ),
                            'email',
                            CAST(:provider_id AS text),
                            now(), now(), now()
                        )
                        """
                    ),
                    {"user_id": user_id, "provider_id": user_id, "email": admin_email},
                )

            conn.execute(
                text(
                    """
                    INSERT INTO public.powermusic_users (id, email, full_name, role)
                    VALUES (CAST(:user_id AS uuid), :email, :full_name, 'admin')
                    ON CONFLICT (id) DO UPDATE
                    SET role = 'admin',
                        email = EXCLUDED.email,
                        full_name = EXCLUDED.full_name,
                        updated_at = now()
                    """
                ),
                {
                    "user_id": user_id,
                    "email": admin_email,
                    "full_name": admin_full_name,
                },
            )
            print(f"Admin '{admin_email}' seeded successfully.")

    except Exception as exc:
        print(f"Error seeding admin user: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
