requisitos:
-node.js 18+ (idealmente 20 o 22)
-npm o yarn
-serverless instalado (npm install -g serverless)
-cuenta aws
-credenciales configuradas .aws/credentials

pasos:
clonar repo
cd hack-back
npm install

el backend requiere una venv JWT_SECRET

recomendamos el uso del siguiente plugin para la .env con serverless:
npm install --save-dev serverless-dotenv-plugin

crear archivo .env
JWT_SECRET=TuClaveSUperSecreta123412

Despliegue:
asegúrate de haber configurado tu org en servverless.yml