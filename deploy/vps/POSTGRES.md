# Recipes on the VPS's own Postgres (off Supabase)

The app already speaks plain Postgres through `DATABASE_URL`; Supabase was only
hosting the database. These steps move the data into Postgres on the VPS and
point the app at it. Nothing in Supabase is changed or deleted.

Run everything as root on the VPS.

## 1. Install Postgres 17

Ubuntu 24.04 ships 16; Supabase runs 15 or 17, and `pg_dump` must be at least
as new as the server it reads, so use the PostgreSQL project's packages.

```sh
apt-get install -y postgresql-common
/usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
apt-get install -y postgresql-17
pg_lsclusters          # 17 main 5432 online
```

Postgres listens on localhost only by default; keep it that way.

## 2. Create the app's database login

```sh
pw=$(openssl rand -hex 24)
sudo -u postgres psql -qc "CREATE ROLE recipes LOGIN PASSWORD '$pw'"
sed -i "s|^DATABASE_URL=.*|DATABASE_URL_LOCAL=postgres://recipes:$pw@127.0.0.1:5432/recipes|" /etc/recipes.env
unset pw
```

`DATABASE_URL_LOCAL` is parked under a different name until the data is in.

## 3. Copy the data from Supabase

Get the **Session pooler** connection string from Supabase (project
cool-cooking-recipes, Connect). If the database password is unknown, reset it
under Project Settings, Database. Then:

```sh
cd /var/www/recipes
read -rsp "Supabase connection string: " SOURCE_URL; echo; export SOURCE_URL
bash deploy/vps/migrate-from-supabase.sh
unset SOURCE_URL
```

It keeps the Supabase dump in `/var/backups/recipes/`, rebuilds the local
database, and prints a row count per table. It stops if any differ.

## 4. Switch the app over

```sh
sed -i 's|^DATABASE_URL_LOCAL=|DATABASE_URL=|' /etc/recipes.env
ln -sf /etc/nginx/sites-available/recipes /etc/nginx/sites-enabled/recipes && nginx -t && systemctl reload nginx
systemctl enable --now recipes recipes-deploy.timer
certbot --nginx -d recipes.antderosa.com --redirect --non-interactive --agree-tos
```

Sign in at https://recipes.antderosa.com and open a recipe with a photo.

## 5. Nightly backups

```sh
cp /var/www/recipes/deploy/vps/recipes-db-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now recipes-db-backup.timer
systemctl start recipes-db-backup && journalctl -u recipes-db-backup -n 2 --no-pager -o cat
```

Dumps land in `/var/backups/recipes/` at 03:20 and are kept for 14 days.
They're on the same disk as the database, so they protect against mistakes,
not against losing the VPS. Copy them off the server for that.

Restore one: `sudo -u postgres pg_restore --clean --if-exists -d recipes /var/backups/recipes/<file>.dump`

Once the site has run on the local database for a while, the Supabase project
can be paused or deleted.
