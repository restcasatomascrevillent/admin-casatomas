// Shared constants to keep the image position selector aligned with the MobilePreview crop.

// In MobilePreview, the phone screen content has px-3, so the card width is ~ (320 - 24) = 296px.
// The image container used to be h-24 (96px). This ratio keeps the same look while making it responsive.
export const MOBILE_PREVIEW_IMAGE_ASPECT_RATIO = 296 / 96;
