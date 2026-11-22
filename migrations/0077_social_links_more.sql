-- v5.65.0: 17 more profile social networks. Members store a HANDLE only; the
-- forum builds each URL from a fixed template. Column-additive (D1 enforces
-- FKs: never rebuild or rename users). Same 120-char ceiling as 0002.
ALTER TABLE users ADD COLUMN social_facebook TEXT CHECK (social_facebook IS NULL OR length(social_facebook) <= 120);
ALTER TABLE users ADD COLUMN social_tumblr TEXT CHECK (social_tumblr IS NULL OR length(social_tumblr) <= 120);
ALTER TABLE users ADD COLUMN social_indiegogo TEXT CHECK (social_indiegogo IS NULL OR length(social_indiegogo) <= 120);
ALTER TABLE users ADD COLUMN social_shopify TEXT CHECK (social_shopify IS NULL OR length(social_shopify) <= 120);
ALTER TABLE users ADD COLUMN social_buymeacoffee TEXT CHECK (social_buymeacoffee IS NULL OR length(social_buymeacoffee) <= 120);
ALTER TABLE users ADD COLUMN social_substack TEXT CHECK (social_substack IS NULL OR length(social_substack) <= 120);
ALTER TABLE users ADD COLUMN social_kickstarter TEXT CHECK (social_kickstarter IS NULL OR length(social_kickstarter) <= 120);
ALTER TABLE users ADD COLUMN social_cameo TEXT CHECK (social_cameo IS NULL OR length(social_cameo) <= 120);
ALTER TABLE users ADD COLUMN social_paypal TEXT CHECK (social_paypal IS NULL OR length(social_paypal) <= 120);
ALTER TABLE users ADD COLUMN social_kofi TEXT CHECK (social_kofi IS NULL OR length(social_kofi) <= 120);
ALTER TABLE users ADD COLUMN social_patreon TEXT CHECK (social_patreon IS NULL OR length(social_patreon) <= 120);
ALTER TABLE users ADD COLUMN social_cashapp TEXT CHECK (social_cashapp IS NULL OR length(social_cashapp) <= 120);
ALTER TABLE users ADD COLUMN social_venmo TEXT CHECK (social_venmo IS NULL OR length(social_venmo) <= 120);
ALTER TABLE users ADD COLUMN social_linktree TEXT CHECK (social_linktree IS NULL OR length(social_linktree) <= 120);
ALTER TABLE users ADD COLUMN social_beacons TEXT CHECK (social_beacons IS NULL OR length(social_beacons) <= 120);
ALTER TABLE users ADD COLUMN social_soundcloud TEXT CHECK (social_soundcloud IS NULL OR length(social_soundcloud) <= 120);
ALTER TABLE users ADD COLUMN social_spotify TEXT CHECK (social_spotify IS NULL OR length(social_spotify) <= 120);
