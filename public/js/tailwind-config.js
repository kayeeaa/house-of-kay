// Shared Tailwind theme for every House of Kay page (load right after the Tailwind CDN script).
tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                charcoal: {
                    900: '#0c0e12',
                    800: '#151821',
                    700: '#1e222e',
                    600: '#2a3040'
                },
                plum: {
                    600: '#7c2d58',
                    500: '#9d3a72',
                    400: '#bd4b8d'
                },
                goldAccent: '#d4af37'
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
                serif: ['Playfair Display', 'serif'],
            }
        }
    }
};
