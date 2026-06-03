import { Module } from '@nestjs/common';
import { AuditModule } from '@common/audit/audit.module';
import { PrismaModule } from '@common/prisma/prisma.module';
import { ProjectsModule } from '@modules/projects/projects.module';
import { WorkManagementController } from './work-management.controller';
import { WorkManagementService } from './work-management.service';

@Module({
  imports: [PrismaModule, ProjectsModule, AuditModule],
  controllers: [WorkManagementController],
  providers: [WorkManagementService],
})
export class WorkManagementModule {}
