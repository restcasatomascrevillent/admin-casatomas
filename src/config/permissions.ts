export const SUPER_ADMIN_EMAILS = (import.meta.env.VITE_SUPER_ADMIN_EMAILS || '').split(',').map((e: string) => e.trim()).filter(Boolean);

export const isSuperAdmin = (email?: string | null): boolean => {
    if (!email) return false;
    return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
};
