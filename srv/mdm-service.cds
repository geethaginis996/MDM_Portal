using { mdm.portal } from '../db/data-model';

service MDMPortalService {

    // =========================================================================
    //  MASTER DATA TYPE & CONFIGURATION
    // =========================================================================
    
    type MasterDataTypeType {
        master_data_type_id: String;
        description: String;
        icon: String;
        object_class: String;
        sequence: Integer;
        active: Boolean;
    }

    entity MasterDataTypes   as projection on portal.MasterDataType;
    entity MetaDisplayTypes  as projection on portal.MetaDisplayType;
    entity MetaDataTypes     as projection on portal.MetaDataType;
    entity MetaFieldStatuses as projection on portal.MetaFieldStatus;
    entity MetaTriggerOns    as projection on portal.MetaTriggerOn;
    entity FieldGroups       as projection on portal.FieldGroup;
    entity FieldMasters as projection on portal.FieldMaster {
        *,
        value_table.value_table_id as value_table_code : String,
        validation.validation_id   as validation_code  : String
    };
    entity ValueTables as projection on portal.ValueTable;
    entity ValidationRules as projection on portal.ValidationRule;

    // =========================================================================
    //  BUSINESS PARTNER CONFIGURATION
    // =========================================================================
    
    entity BPCategories as projection on portal.BPCategory;
    entity BPCategoryFields as projection on portal.BPCategoryField;
    entity BPRoles as projection on portal.BPRole;
    entity BPRoleFields as projection on portal.BPRoleField;
    entity BPRolePrereqFields as projection on portal.BPRolePrereqField;
    entity BPRoleDependencies as projection on portal.BPRoleDependency;

    // =========================================================================
    //  ACCOUNT ASSIGNMENT GROUPS
    // =========================================================================
    
    entity AccountGroups as projection on portal.AccountGroup;
    entity AccountGroupFields as projection on portal.AccountGroupField;

    // =========================================================================
    //  LOOKUP TABLES (Master Data Replicated from SAP)
    // =========================================================================
    
    entity CompanyCodes as projection on portal.LK_CompanyCode;
    entity SalesOrgs as projection on portal.LK_SalesOrg;
    entity DistChannels as projection on portal.LK_DistChannel;
    entity Divisions as projection on portal.LK_Division;
    entity PurchOrgs as projection on portal.LK_PurchOrg;
    entity PurchGroups as projection on portal.LK_PurchGroup;
    entity Plants as projection on portal.LK_Plant;
    entity PaymentTerms as projection on portal.LK_PaymentTerm;
    entity Countries as projection on portal.LK_Country;
    entity Currencies as projection on portal.LK_Currency;
    entity Industries as projection on portal.LK_Industry;
    entity MaterialTypes as projection on portal.LK_MaterialType;
    entity MaterialGroups as projection on portal.LK_MaterialGroup;
    entity SalesAreas as projection on portal.LK_SalesArea;
    entity ReconAccts as projection on portal.LK_ReconAcct;
    entity Regions as projection on portal.LK_Region;
    entity TaxCodes as projection on portal.LK_TaxCode;
    
    // Replication jobs (read-only)
    entity ReplicationLogs as projection on portal.ReplicationLog;

    // =========================================================================
    //  RELEASE STRATEGY CONFIGURATION
    // =========================================================================
    
    entity StrategyCharacteristics as projection on portal.StrategyCharacteristic;
    entity ReleaseCodes as projection on portal.ReleaseCode;
    entity ReleaseCodeUsers as projection on portal.ReleaseCodeUser;
    entity ReleaseCodeScopes as projection on portal.ReleaseCodeScope;
    entity ReleaseStrategies as projection on portal.ReleaseStrategy;
    entity ReleaseStrategyValues as projection on portal.ReleaseStrategyValue;
    entity ReleaseStrategySteps as projection on portal.ReleaseStrategyStep;

    // =========================================================================
    //  CHANGE REQUEST (Core Domain)
    // =========================================================================
    
    type ChangeRequestDraft {
        cr_id: String;
        cr_group_id: String;
        request_type: String;
        master_data_type_id: String;
        scenario_code: String;
        reference_object_no: String;
        business_justification: String;
        priority: String;
    }

    entity ChangeRequests as projection on portal.CRHeader {
        *, 
        bp_roles: redirected to CRBPRoles,
        field_values: redirected to CRFieldValues,
        attachments: redirected to CRAttachments
    }
    excluding { DraftAdministrativeData };

    entity CRBPRoles as projection on portal.CRBPRole;
    entity CRFieldValues as projection on portal.CRFieldValue;
    entity CRAttachments as projection on portal.CRAttachment;

    // =========================================================================
    //  RELEASE STRATEGY EXECUTION
    // =========================================================================
    
    entity CRReleaseStrategies as projection on portal.CRReleaseStrategy {
        *,
        steps: redirected to CRReleaseSteps
    };
    
    entity CRReleaseSteps as projection on portal.CRReleaseStep;
    entity CRApprovalDecisions as projection on portal.CRApprovalDecision;

    // =========================================================================
    //  AUDIT & NOTIFICATIONS (Read-Only)
    // =========================================================================
    
    entity AuditLogs as projection on portal.AuditLog;
    entity Notifications as projection on portal.Notification;

    // =========================================================================
    //  CUSTOM ACTIONS & FUNCTIONS - CHANGE REQUESTS
    // =========================================================================

    // Submit a change request for approval
    action submitChangeRequest(
        cr_id: String
    ) returns {
        success: Boolean;
        message: String;
        strategy_id: String;
    };

    // Release/Approve a step in the workflow
    action approveReleaseStep(
        cr_id: String,
        step_number: Integer,
        comment: String,
        action: String // APPROVE | REJECT | SEND_BACK
    ) returns {
        success: Boolean;
        message: String;
        next_step: Integer;
    };

    // Post a change request to SAP
    action postChangeRequest(
        cr_id: String
    ) returns {
        success: Boolean;
        message: String;
        posted_object_no: String;
    };

    // Get available actions for a CR
    function getAvailableActions(
        cr_id: String
    ) returns {
        actions: array of {
            action: String;
            available: Boolean;
            reason: String;
        };
    };

    // Get release strategy for a CR
    function determineReleaseStrategy(
        master_data_type_id: String,
        scenario_code: String,
        values: array of {
            characteristic_id: String;
            value: String;
        }
    ) returns {
        strategy_id: String;
        steps_count: Integer;
        estimated_duration_hours: Integer;
    };

    // Replicate lookup tables from SAP
    action syncLookupTable(
        table_name: String
    ) returns {
        success: Boolean;
        message: String;
        rows_synced: Integer;
    };

    // Get field configuration for a role
    function getFieldsForRole(
        role_id: String
    ) returns {
        fields: array of {
            field_id: String;
            description: String;
            status: String; // REQUIRED | OPTIONAL | SUPPRESS
            value_table_id: String;
            display_type: String;
        };
    };

    // =========================================================================
    //  CUSTOM ACTIONS & FUNCTIONS - FIELD MASTER OPERATIONS
    // =========================================================================

    action ActivateField(field_id: String) returns {
        success: Boolean;
        message: String;
    };

    action BulkActivateFields(fieldIds: array of String) returns {
        success: Boolean;
        activated: Integer;
        failed: Integer;
    };

    action DeleteField(field_id: String) returns {
        success: Boolean;
        message: String;
    };

    action BulkDeleteFields(fieldIds: array of String) returns {
        success: Boolean;
        deleted: Integer;
        failed: Integer;
    };

    function GetFieldsByMasterDataType(masterDataTypeId: String) 
        returns array of FieldMasters;

    function ValidateField(field_id: String, value: String) returns {
        isValid: Boolean;
        errorMessage: String;
    };
}

// =============================================================================
//  REPORTING SERVICE (Optional - for dashboards)
// =============================================================================

service ReportingService {
    
    // Change Request Dashboard
    type CRSummary {
        total_count: Integer;
        draft_count: Integer;
        in_approval_count: Integer;
        approved_count: Integer;
        rejected_count: Integer;
        posted_count: Integer;
    }

    function getCRSummary(
        date_from: Date,
        date_to: Date
    ) returns CRSummary;

    // Approval Workload by Role
    type ApprovalWorkload {
        role_id: String;
        role_description: String;
        pending_count: Integer;
        overdue_count: Integer;
        average_duration_hours: Decimal;
    }

    function getApprovalWorkload() returns array of ApprovalWorkload;

    // Field Usage Statistics
    type FieldUsageStats {
        field_id: String;
        field_description: String;
        usage_count: Integer;
        most_common_value: String;
    }

    function getFieldUsageStats(
        master_data_type_id: String
    ) returns array of FieldUsageStats;

    // Read-only projections for reporting
    entity CRHeaderReporting as projection on portal.CRHeader;
    entity CRApprovalHistoryReporting as projection on portal.CRApprovalDecision;
    entity AuditLogReporting as projection on portal.AuditLog;
}