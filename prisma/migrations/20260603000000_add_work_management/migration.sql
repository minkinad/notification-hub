-- CreateEnum
CREATE TYPE "WorkCycleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkModuleStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkItemStatus" AS ENUM ('BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "WorkItemPriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "WorkViewLayout" AS ENUM ('KANBAN', 'LIST', 'CALENDAR', 'GANTT');

-- CreateTable
CREATE TABLE "work_cycles" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkCycleStatus" NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_modules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkModuleStatus" NOT NULL DEFAULT 'PLANNED',
    "targetDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "WorkItemStatus" NOT NULL DEFAULT 'BACKLOG',
    "priority" "WorkItemPriority" NOT NULL DEFAULT 'NONE',
    "labels" JSONB NOT NULL DEFAULT '[]',
    "estimate" INTEGER,
    "dueDate" TIMESTAMP(3),
    "sortOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "cycleId" TEXT,
    "moduleId" TEXT,
    "assigneeId" TEXT,
    "reporterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "work_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_item_comments" (
    "id" TEXT NOT NULL,
    "workItemId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_item_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_views" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "layout" "WorkViewLayout" NOT NULL DEFAULT 'KANBAN',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_cycles_projectId_idx" ON "work_cycles"("projectId");

-- CreateIndex
CREATE INDEX "work_cycles_status_idx" ON "work_cycles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "work_cycles_projectId_name_key" ON "work_cycles"("projectId", "name");

-- CreateIndex
CREATE INDEX "work_modules_projectId_idx" ON "work_modules"("projectId");

-- CreateIndex
CREATE INDEX "work_modules_status_idx" ON "work_modules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "work_modules_projectId_name_key" ON "work_modules"("projectId", "name");

-- CreateIndex
CREATE INDEX "work_items_projectId_idx" ON "work_items"("projectId");

-- CreateIndex
CREATE INDEX "work_items_status_idx" ON "work_items"("status");

-- CreateIndex
CREATE INDEX "work_items_priority_idx" ON "work_items"("priority");

-- CreateIndex
CREATE INDEX "work_items_cycleId_idx" ON "work_items"("cycleId");

-- CreateIndex
CREATE INDEX "work_items_moduleId_idx" ON "work_items"("moduleId");

-- CreateIndex
CREATE INDEX "work_items_assigneeId_idx" ON "work_items"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "work_items_projectId_sequence_key" ON "work_items"("projectId", "sequence");

-- CreateIndex
CREATE INDEX "work_item_comments_workItemId_idx" ON "work_item_comments"("workItemId");

-- CreateIndex
CREATE INDEX "work_item_comments_authorId_idx" ON "work_item_comments"("authorId");

-- CreateIndex
CREATE INDEX "work_views_projectId_idx" ON "work_views"("projectId");

-- CreateIndex
CREATE INDEX "work_views_createdById_idx" ON "work_views"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "work_views_projectId_name_key" ON "work_views"("projectId", "name");

-- AddForeignKey
ALTER TABLE "work_cycles" ADD CONSTRAINT "work_cycles_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_modules" ADD CONSTRAINT "work_modules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "work_cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "work_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "work_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_item_comments" ADD CONSTRAINT "work_item_comments_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_views" ADD CONSTRAINT "work_views_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_views" ADD CONSTRAINT "work_views_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
