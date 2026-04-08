-- Add isTrainee to Employee
ALTER TABLE "Employee" ADD COLUMN "isTrainee" BOOLEAN NOT NULL DEFAULT false;

-- Add probationMonths to LeavePolicy
ALTER TABLE "LeavePolicy" ADD COLUMN "probationMonths" INTEGER NOT NULL DEFAULT 3;

-- Add activatesOn to LeaveEntitlement
ALTER TABLE "LeaveEntitlement" ADD COLUMN "activatesOn" TIMESTAMP(3);
