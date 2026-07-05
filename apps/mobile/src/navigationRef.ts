import { createNavigationContainerRef } from '@react-navigation/native';

/**
 * Ref global al contenedor de navegación. La sidebar vive fuera del árbol de
 * pantallas, así que navega a través de esta ref en lugar de useNavigation().
 */
export const navigationRef = createNavigationContainerRef<any>();
