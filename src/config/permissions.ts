export const SUPER_ADMIN_EMAILS = [
    "miguelsantiagores@gmail.com", // Email del desarrollador/dueño
    "info@casatomas.es",           // Email corporativo probable
    "admin@admin.com"              // Email genérico por si acaso
];

export const isSuperAdmin = (email?: string | null): boolean => {
    if (!email) return false;
    return SUPER_ADMIN_EMAILS.includes(email.toLowerCase());
};
