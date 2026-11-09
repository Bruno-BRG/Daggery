# Character images

Click the portrait on a character sheet, or open **Character actions → Character images**. Portrait, banner, and table token each have their own upload, preview, replace, and remove controls. Position the image in the crop preview before saving. Square portraits and tokens and a 3:1 banner preserve the selected framing. Portraits appear on the sheet and character library; banners appear across the sheet header and library card.

PNG, JPEG, and WebP are supported, up to 10 MB. Source images must fit within 8192 pixels per side and 32 megapixels. The browser crops and compresses uploads, limiting portraits to 1024px, banners to 2048px wide, and tokens to 512px. Transparent images remain transparent. Existing characters keep class art until customized.

The optional `portraitUrl`, `bannerUrl`, and `tokenUrl` fields live in the existing sheet document; no schema migration is needed. The dedicated `POST /api/campaigns/:campaignId/character-images` route follows sheet write permissions, checks signatures and dimensions, rejects documents, and stores images in persistent campaign assets with shared visibility. Campaign membership is required to fetch them. The general GM asset upload route retains its existing permissions and visibility.

New linked miniatures follow the character token image, falling back to the portrait and then class art. Existing class-art miniatures follow these changes too. Scene-specific image overrides are preserved. Miniature settings offer **Use character image** to restore the link. Extensionless campaign image URLs explicitly select Pixi's texture loader.

Removing a character image clears its reference and restores the fallback. Uploaded assets remain stored because other documents or scene overrides may still reference them.

Validation includes member uploads and image retrieval, outsider isolation, file signature/dimension/size limits, crop math, fallback rules, and live token links. Browser QA covers cropping/uploading all three image types, actual Pixi texture loading, refresh persistence, removal, and layouts at desktop, 390px and 320px.
