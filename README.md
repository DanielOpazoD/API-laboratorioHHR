# Syslab Scraper & Microservicio de Integración HHR

Este proyecto es un microservicio autónomo desarrollado usando Node.js, Express, Jest y Playwright. Tiene como objetivo automatizar la extracción de exámenes de laboratorio clínico desde el portal intranet Syslab (`http://10.4.69.90/syslab/`), pasándolos por un motor de parseo de PDF para normalizarlos en un esquema JSON estructurado.

## Arquitectura Dual

La aplicación está diseñada bajo principios SOLID. Funciona bajo dos modalidades que interactúan armoniosamente:

### 1. Modalidad *Standalone* (API Independiente / Local Activo)
El microservicio funciona por sí solo exponiendo una Interfaz REST para consulta dinámica:

*   **`GET /api/exams?rut=XXXXX-X`**: Inicia Chromium en entorno *headless*, hace login en Syslab y devuelve las cabeceras/etiquetas de los últimos exámenes vinculados a esa persona en formato JSON.
*   **`POST /api/exams/details`** (Recibe `{ "links": ["...", "..."] }`): Navega y extrae los recursos PDF de los exámenes alojados detrás de esos links. Los pasa por funciones puras de Regex (en `utils/reportParser.js`) que limpian el ruido bruto y entregan un objeto ordenado listando Título, Operando, Unidad y Referencia.

### 2. Modalidad *Daemon HHR* (Autopilot Sync vía Firebase Admin)
Opera como un "Trabajador de Fondo" fusionándose bidireccionalmente con el ecosistema Firestore de tu otra aplicación madre (HHR).

*   **`POST /api/sync/labs`**: Es un *Webhook* asíncrono. Al ser ejecutado, devuelve inmediatamente un status `200 OK` delegando el ruteo a un worker en memoria que se conecta a Firestore, extrae la lista base de pacientes, consulta Syslab masivamente, formatea los datos y los dispara directo de vuelta a la nube de tu App HHR.

---

## 🤖 Guía Rápida de Interoperabilidad (Para Agentes IA e Ingenieros)

> **Contexto Técnico:** 
> Si otra IA está analizando cómo unir la Aplicación A (HHR) con la Aplicación B (Este Scraper), este es el contrato que garantiza la transferencia de datos y su mutua operabilidad.

#### Protocolo de Variables (Entorno)
Este scraper necesita un `.env` en su raíz con:
- `PORT=3000`
- `SYSLAB_BASE_URL`, `SYSLAB_USER`, `SYSLAB_PASS`
- `FIREBASE_SERVICE_ACCOUNT_PATH` (Apunta a las credenciales privadas `.json` extraidas de Google Cloud para eludir controles OAUTH y operar directamente sobre las colecciones).
- `HOSPITAL_ID` (Si se omite, opera sobre la constante `'salvador'`).

#### Contrato de Lectura de Firebase (Desde HHR al Scraper)
Al lanzar el webhook de sync masivo, el scraper se dirigirá al path `hospitals/<HOSPITAL_ID>/patients` usando Admin SDK.
Asume intrínsecamente que los IDs de los documentos (`doc.id`) de todos los pacientes en esa colección corresponden con RUTs chilenos válidos. Con esos iterables, comenzará su orquestación.

#### Contrato de Inyección en Firebase (De Scraper hacia HHR)
Una vez que el Regex termina de modelar la data extraída de Syslab, el scraper generará documentos nuevos en `hospitals/<HOSPITAL_ID>/clinicalDocuments`. 

El output generado para Firestore respeta estrictamente la interfaz Typescript `ClinicalDocumentRecord` que tu arquitectura HHR espera desde hace años:

```json
{
  "id": "uuid-v4...",
  "episodeKey": "<string: rut del paciente>",
  "documentType": "laboratorio_syslab",
  "patientId": "<string: rut del paciente>",
  "status": "signed",
  "isLocked": true,
  "audit": {
    "updatedAt": "2026-04-06T...",
    "updatedBy": "syslab-scraper-service"
  },
  "data": [
    { 
      "section": "PERFIL BIOQUÍMICO", 
      "analysis": "Glucosa", 
      "result": "90", 
      "unit": "mg/dL",
      "refValue": "70 - 99"
    }
  ],
  "metadata": {
    "originUrl": "http://10.../detalle.php..."
  }
}
```

> **Consejo Final de Arquitectura:** En el Frontend principal de HHR, **jamás llamas** a `/api/sync/labs` usando el Fetch del navegador durante la sesión de un usuario. Esto causaría un efecto en cadena de bots lentos en Syslab. La unión correcta entre ambos mundos consiste en colgar un Cron Scheduler (Ej. Google Scheduler u otro servicio en la nube) que active mediante HTTP `POST` este webhook silencioso programándolo a las 05:00 AM y a las 14:00 PM cada día. Así la aplicación madre se alimentará automáticamente y estará fresca cuando los médicos la evalúen.
