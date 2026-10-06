/**
 * Fixture "customer repo": aplikasi logistik Next.js + Prisma + Postgres + CI.
 * Dipakai sebagai target uji saat GIT_PROVIDER=mock, dan sebagai fixture test extractor.
 * ponytail: string literal, bukan file sungguhan — supaya demo jalan di Vercel tanpa FS.
 */
export const DEMO_REPO_URL = "https://github.com/logistics-id/logitrack-web";
export const DEMO_BRANCH = "main";

const files: Record<string, string> = {
  "package.json": `{
  "name": "logitrack-web",
  "version": "2.4.1",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build", "lint": "next lint", "test": "jest" },
  "dependencies": { "next": "15.1.0", "react": "19.0.0", "@prisma/client": "6.1.0", "zod": "3.23.8" },
  "devDependencies": { "jest": "29.7.0", "@playwright/test": "1.49.0", "typescript": "5.6.3" }
}`,

  "docker-compose.yml": `services:
  web:
    build: .
    ports: ["3000:3000"]
    depends_on: [api, postgres]
  api:
    build: ./services/api
    environment:
      DATABASE_URL: postgresql://logistics:***@postgres:5432/logistics
    depends_on: [postgres, redis]
  postgres:
    image: postgres:16-alpine
    volumes: [logistics-data:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
volumes:
  logistics-data:
`,

  "Dockerfile": `FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app ./
CMD ["npm", "run", "start"]
`,

  "prisma/schema.prisma": `generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Warehouse {
  id        String     @id @default(uuid())
  code      String     @unique
  name      String
  region    String
  createdAt DateTime   @default(now())
  shipments Shipment[]
}

model Driver {
  id            String         @id @default(uuid())
  employeeNo    String         @unique
  fullName      String
  licenseNo     String
  phone         String
  apiToken      String?        // sensitive
  status        DriverStatus   @default(OFF_DUTY)
  assignments   Shipment[]
}

enum DriverStatus {
  OFF_DUTY
  ON_DUTY
  ON_BREAK
}

model Shipment {
  id          String       @id @default(uuid())
  ref         String       @unique
  origin      Warehouse    @relation(fields: [originId], references: [id])
  destination Warehouse    @relation(fields: [destinationId], references: [id])
  driver      Driver?      @relation(fields: [driverId], references: [id])
  weightKg    Float
  priceTotal  Decimal      @db.Decimal(12, 2)
  status      ShipmentStatus @default(BOOKED)
  etaAt       DateTime?
  createdAt   DateTime     @default(now())
  events      DeliveryEvent[]
}

enum ShipmentStatus {
  BOOKED
  PICKED_UP
  IN_TRANSIT
  DELIVERED
  CANCELLED
}

model DeliveryEvent {
  id         String   @id @default(uuid())
  shipment   Shipment @relation(fields: [shipmentId], references: [id], onDelete: Cascade)
  status     ShipmentStatus
  latitude   Float?
  longitude  Float?
  note       String?
  recordedAt DateTime @default(now())
}

model Customer {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  billingToken String?  // sensitive
  shipments    Shipment[]
}
`,

  "docs/openapi.yaml": `openapi: 3.0.3
info:
  title: LogiTrack Public API
  version: 2.4.1
paths:
  /api/shipments:
    get:
      summary: List shipments
      security: [{ bearerAuth: [] }]
      responses: { "200": { description: OK } }
    post:
      summary: Book a shipment
      security: [{ bearerAuth: [] }]
      responses: { "201": { description: Created }, "422": { description: Validation error } }
  /api/shipments/{ref}/track:
    get:
      summary: Track shipment by reference
      security: []
      responses: { "200": { description: OK }, "404": { description: Not found } }
  /api/shipments/{ref}/events:
    post:
      summary: Append delivery event
      security: [{ bearerAuth: [] }]
      responses: { "204": { description: No content } }
  /api/drivers:
    get:
      summary: List drivers
      security: [{ bearerAuth: [] }]
      responses: { "200": { description: OK } }
  /api/warehouses:
    get:
      summary: List warehouses
      security: []
      responses: { "200": { description: OK } }
  /api/export:
    get:
      summary: Export all shipments as CSV
      security: []
      responses: { "200": { description: OK } }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer }
`,

  ".github/workflows/ci.yml": `name: CI
on:
  push:
    branches: [main]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run lint
  typecheck:
    runs-on: ubuntu-latest
    needs: lint
    steps:
      - uses: actions/checkout@v4
      - run: npx tsc --noEmit
  unit:
    runs-on: ubuntu-latest
    needs: typecheck
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  build:
    runs-on: ubuntu-latest
    needs: unit
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t logitrack:\${{ github.sha }} .
  scan:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: aquasecurity/trivy-action@0.28.0
  deploy-staging:
    runs-on: ubuntu-latest
    needs: scan
    environment: staging
    steps:
      - run: ./deploy.sh staging
  deploy-prod:
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment: production
    steps:
      - run: ./deploy.sh prod
`,

  "src/app/api/shipments/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const shipments = await prisma.shipment.findMany({ take: 50 });
  return NextResponse.json({ shipments });
}

export async function POST(req: Request) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const created = await prisma.shipment.create({ data: body });
  return NextResponse.json(created, { status: 201 });
}
`,

  "src/app/api/shipments/[ref]/track/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: { ref: string } }) {
  const shipment = await prisma.shipment.findUnique({
    where: { ref: params.ref },
    include: { events: { orderBy: { recordedAt: "desc" } } },
  });
  if (!shipment) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(shipment);
}
`,

  "src/app/api/shipments/[ref]/events/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth";

export async function POST(req: Request, { params }: { params: { ref: string } }) {
  const user = await requireAuth(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const payload = await req.json();
  await prisma.deliveryEvent.create({ data: { ...payload, ref: params.ref } });
  return new NextResponse(null, { status: 204 });
}
`,

  "src/app/api/drivers/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const drivers = await prisma.driver.findMany();
  return NextResponse.json({ drivers });
}
`,

  "src/app/api/warehouses/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  const warehouses = await prisma.warehouse.findMany();
  return NextResponse.json({ warehouses });
}
`,

  "src/app/api/export/route.ts": `import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// TODO: add auth before exposing publicly
export async function GET() {
  const rows = await prisma.shipment.findMany();
  return NextResponse.json(rows);
}
`,

  "src/app/(dashboard)/page.tsx": `export default function DashboardPage() {
  return (
    <main>
      <h1 data-testid="dashboard-title">LogiTrack Control Tower</h1>
      <ShipmentTable />
    </main>
  );
}
`,

  "src/app/(dashboard)/shipments/page.tsx": `export default function ShipmentsPage() {
  return (
    <main>
      <h1>Shipments</h1>
      <button data-testid="new-shipment">New shipment</button>
      <table><tbody data-testid="shipments-table" /></table>
    </main>
  );
}
`,

  "src/app/(dashboard)/drivers/page.tsx": `export default function DriversPage() {
  return <main><h1>Drivers</h1><ul data-testid="drivers-list" /></main>;
}
`,

  "src/app/login/page.tsx": `export default function LoginPage() {
  return (
    <main>
      <form>
        <input name="email" />
        <input name="password" type="password" />
        <button data-testid="login-submit">Sign in</button>
      </form>
    </main>
  );
}
`,

  "src/lib/db.ts": `import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export async function closeDb() {
  await prisma.$disconnect();
}
`,

  "src/lib/auth.ts": `import { verifyToken } from "@/lib/token";

export async function requireAuth(req: Request) {
  const header = req.headers.get("authorization");
  if (!header) return null;
  return verifyToken(header.replace("Bearer ", ""));
}
`,

  "src/lib/token.ts": `import { createHmac } from "node:crypto";

export function verifyToken(token: string) {
  return { sub: createHmac("sha256", process.env.JWT_SECRET ?? "dev").update(token).digest("hex") };
}
`,

  "src/services/shipment.service.ts": `import { prisma } from "@/lib/db";

export async function assignDriver(ref: string, driverId: string) {
  return prisma.shipment.update({ where: { ref }, data: { driverId, status: "IN_TRANSIT" } });
}
`,

  "src/services/billing.service.ts": `import { prisma } from "@/lib/db";

export async function invoice(customerId: string) {
  return prisma.shipment.aggregate({ where: { ref: { startsWith: customerId } }, _sum: { priceTotal: true } });
}
`,

  "tests/pricing.spec.ts": `describe("pricing", () => {
  it("computes zone surcharge", () => {
    expect(zoneSurcharge(3)).toBe(45);
  });
});
`,

  "README.md": `# LogiTrack Web

Platform operasional logistik: booking shipment, tracking publik, dispatch driver.
`,
};

export const demoRepo = (): Record<string, string> => structuredClone(files);
export const DEMO_COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";