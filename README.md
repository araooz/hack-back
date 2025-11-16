# Hackathon Backend - Sistema de Gestión de Incidentes

## Requisitos

- Node.js 18+ (idealmente 20 o 22)
- npm o yarn
- Serverless instalado (npm install -g serverless)
- Cuenta AWS
- Credenciales configuradas en `.aws/credentials`

## Instalación

1. Clonar el repositorio
2. `cd hack-back`
3. `npm install`

El backend requiere una variable de entorno `JWT_SECRET` para la autenticación.

Recomendamos el uso del siguiente plugin para la `.env` con serverless:
```bash
npm install --save-dev serverless-dotenv-plugin
```

Crear archivo `.env`:
```
JWT_SECRET=TuClaveSUperSecreta123412
```

## Despliegue

Asegúrate de haber configurado tu org en `serverless.yml` antes de desplegar.

---

## Flujo de la Aplicación

### 1. Registro de Usuario

Para comenzar a usar la aplicación, primero debes crear una cuenta. El registro requiere:
- **Email**: Debe tener un formato válido y ser único en el sistema
- **Username**: Nombre de usuario único
- **Password**: Mínimo 8 caracteres, al menos una minúscula y un número
- **Role**: Tu rol en el sistema puede ser:
  - `User`: Usuario regular que puede reportar y cancelar sus propios incidentes
  - `Worker`: Trabajador que puede asignar, trabajar y resolver incidentes
  - `Admin`: Administrador con permisos completos
- **Department**: Departamento al que perteneces (opcional):
  - `IT`, `Cleaner`, `Infrastructure`, `Security`, `Emergency`, o `None` (por defecto)

Una vez registrado, recibirás un `userId` único que te identifica en el sistema.

### 2. Inicio de Sesión

Para acceder a las funcionalidades protegidas, debes iniciar sesión con tu email y contraseña. Al autenticarte correctamente, recibirás un **token JWT** que debes incluir en todas las peticiones posteriores como cabecera `Authorization: Bearer <token>`.

Este token contiene tu información de usuario (userId, role, email, department) y expira después de un tiempo determinado. Si el token expira, deberás iniciar sesión nuevamente.

### 3. Crear un Incidente

Una vez autenticado, puedes crear nuevos incidentes. Para reportar un incidente necesitas proporcionar:
- **Category**: Categoría del incidente (`IT`, `Cleaner`, `Infrastructure`, `Security`, `Emergency`)
- **Place**: Ubicación donde ocurre el incidente
- **Description**: Descripción detallada del problema
- **Urgency**: Nivel de urgencia (`low`, `medium`, `high`) - por defecto es `low` si no se especifica

Al crear un incidente, este se guarda con estado inicial `reported` y se notifica en tiempo real a todos los usuarios conectados vía WebSocket. El sistema te devuelve el `incidentId` único del incidente creado.

### 4. Ver Incidentes

Puedes consultar todos los incidentes del sistema. Esta funcionalidad está disponible para todos los usuarios autenticados y muestra la lista completa de incidentes con toda su información: estado actual, categoría, lugar, descripción, urgencia, quién lo creó, y si está resuelto, quién lo resolvió y cuándo.

### 5. Actualizar Estado de un Incidente

El sistema permite cambiar el estado de los incidentes, pero los permisos varían según tu rol:

**Estados disponibles:**
- `reported`: Estado inicial cuando se crea el incidente
- `assigned`: El incidente ha sido asignado a un trabajador
- `working`: Un trabajador está trabajando en el incidente
- `solved`: El incidente ha sido resuelto
- `cancelled`: El incidente ha sido cancelado

**Permisos por rol:**
- **Usuarios (User)**: Solo pueden cancelar los incidentes que ellos mismos crearon
- **Trabajadores (Worker)**: Pueden cambiar el estado a `assigned`, `working` o `solved`
- **Administradores (Admin)**: Pueden cambiar a cualquier estado válido

**Reglas de transición:**
- Los estados solo pueden avanzar hacia adelante, no retroceder
- Una vez que un incidente está `solved` o `cancelled`, no puede cambiar de estado
- Las transiciones válidas son:
  - `reported` → `assigned` o `cancelled`
  - `assigned` → `working` o `cancelled`
  - `working` → `solved` o `cancelled`

Cuando un incidente se marca como `solved`, el sistema automáticamente registra quién lo resolvió y la fecha/hora de resolución. Al igual que con la creación, los cambios de estado se notifican en tiempo real a todos los usuarios conectados.

### Notificaciones en Tiempo Real

El sistema incluye WebSocket para notificaciones en tiempo real. Cuando se crea o actualiza un incidente, todos los usuarios conectados reciben una notificación automática con la información del cambio, permitiendo que el dashboard se actualice sin necesidad de refrescar la página.