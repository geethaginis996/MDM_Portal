namespace mdm.portal;
using { managed } from '@sap/cds/common';
using { mdm.portal } from '../db/data-model';


entity MetaDataType {
    key code        : String(20);
        description : String(60) not null;
        sequence    : Integer default 99;
}



entity MetaFieldStatus {
    key code        : String(10);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaTriggerOn {
    key code        : String(10);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaAccountType {
    key code        : String(10);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaAssignMode {
    key code        : String(10);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaCRStatus {
    key code        : String(20);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaCRPriority {
    key code        : String(10);
        description : String(60) not null;
        sequence    : Integer default 99;
}

entity MetaObjectClass {
    key code        : String(20);
        description : String(60) not null;
        sequence    : Integer default 99;
}

type MasterDataObjectClass  : String(20) @assert.range enum { BP; MATERIAL; };
type DisplayType            : String(20) @assert.range enum { INPUT; DROPDOWN; SEARCH_HELP; CHECKBOX; DATEPICKER; };
type DataType               : String(20) @assert.range enum { STRING; INTEGER; DECIMAL; DATE; BOOLEAN; };
type FieldStatus            : String(10) @assert.range enum { REQUIRED; OPTIONAL; SUPPRESS; };
type ActiveStatus           : String(10) @assert.range enum { ACTIVE; INACTIVE; };
type TriggerOn              : String(10) @assert.range enum { FIELD; SAVE; };
type AccountType            : String(10) @assert.range enum { CUSTOMER; VENDOR; };
type AccountScope           : String(10) @assert.range enum { CUSTOMER; VENDOR; BOTH; };
type AssignmentMode         : String(10) @assert.range enum { INTERNAL; EXTERNAL; };
type AssignmentType         : String(10) @assert.range enum { USER; GROUP; };
type ScopeType              : String(20) @assert.range enum { BP_ROLE; MATERIAL_VIEW; FIELD_GROUP; };
type StrategyDataType       : String(20) @assert.range enum { STRING; INTEGER; };
type ReplicationStatus      : String(10) @assert.range enum { RUNNING; SUCCESS; FAILED; };
type OverallApprovalStatus  : String(20) @assert.range enum { IN_PROGRESS; APPROVED; REJECTED; CANCELLED; };
type StepStatus             : String(20) @assert.range enum { PENDING; IN_PROGRESS; APPROVED; REJECTED; SENT_BACK; SKIPPED; };
type ApprovalAction         : String(20) @assert.range enum { APPROVE; REJECT; SEND_BACK; REASSIGN; ESCALATE; };
type AuditAction            : String(20) @assert.range enum { CREATE; UPDATE; DELETE; SUBMIT; APPROVE; REJECT; SEND_BACK; POST; ESCALATE; };
type NotificationEvent      : String(30) @assert.range enum { ASSIGNED; APPROVED; REJECTED; SENT_BACK; ESCALATED; POSTED; POSTING_FAILED; };
type NotificationChannel    : String(10) @assert.range enum { EMAIL; IN_APP; };
type NotificationStatus     : String(10) @assert.range enum { PENDING; SENT; FAILED; };
type OperatorType           : String(10) @assert.range enum { EQ; NE; ![IN]; ![ANY]; };

type CRRequestType          : String(10) @assert.range enum { CREATE; CHANGE; EXTEND; };
type CRPriority             : String(10) @assert.range enum { NORMAL; HIGH; };
type CRStatus               : String(20) @assert.range enum { DRAFT; IN_APPROVAL; APPROVED; REJECTED; POSTED; POSTING_FAILED; CANCELLED; SENT_BACK; };



entity MasterDataType : managed {
    key master_data_type_id : String(30);
        description         : String(100)          not null;
        icon                : String(40);
        object_class        : MasterDataObjectClass not null;
        sequence            : Integer               not null;
        active              : Boolean               not null default true;
}

entity FieldGroup : managed {
    key group_id            : String(20);
        parent_group_id     : Association to FieldGroup;
        master_data_type    : Association to MasterDataType not null;
        description         : String(100) not null;
        icon                : String(40);
        sequence            : Integer     not null;
        active              : Boolean     not null default true;
}

entity ValueTable : managed {
    key value_table_id  : String(20);
        description     : String(100) not null;
        source_table    : String(60)  not null;
        input_1         : String(40);
        input_2         : String(40);
        input_3         : String(40);
        output_key      : String(40)  not null;
        output_desc     : String(40)  not null;
        status          : ActiveStatus not null;
}

entity ValidationRule : managed {
    key validation_id   : String(20);
        description     : String(100) not null;
        function_name   : String(80)  not null;
        input_param_1   : String(200);
        input_param_2   : String(200);
        input_param_3   : String(200);
        trigger_on      : TriggerOn   not null;
        error_message   : String(200) not null;
}

entity FieldMaster : managed {
    key field_id        : String(40);
        description     : String(100)  not null;
        data_type       : DataType     not null;
        length          : Integer;
        decimals        : Integer;
        main_group      : Association to FieldGroup;
        sub_group       : Association to FieldGroup;
        value_table     : Association to ValueTable;
        display_type    : DisplayType  not null;
        validation      : Association to ValidationRule;
        source_table    : String(40);
        source_field    : String(40);
        active          : Boolean      not null default true;
}

entity BPCategory : managed {
    key category_id     : String(20);
        description     : String(100) not null;
        icon            : String(40);
        sequence        : Integer     not null;
        active          : Boolean     not null default true;
        fields          : Composition of many BPCategoryField on fields.category = $self;
}

entity BPCategoryField : managed {
    key category        : Association to BPCategory  not null;
    key field           : Association to FieldMaster not null;
        field_status    : FieldStatus not null;
        sequence        : Integer     not null;
        default_value   : String(200);
        multiple_values : Boolean     not null default false;
}

entity BPRole : managed {
    key role_id             : String(10);
        description         : String(100) not null;
        master_data_type    : Association to MasterDataType not null;
        account_scope       : AccountScope not null default 'CUSTOMER';
        initial_bp_required : Boolean     not null default false;
        sequence            : Integer     not null;
        active              : Boolean     not null default true;
        fields              : Composition of many BPRoleField on fields.role = $self;
        prereq_fields       : Composition of many BPRolePrereqField on prereq_fields.role = $self;
        dependencies        : Composition of many BPRoleDependency on dependencies.role = $self;
}

entity BPRoleField : managed {
    key role            : Association to BPRole      not null;
    key field           : Association to FieldMaster not null;
        field_status    : FieldStatus not null;
        sequence        : Integer     not null;
        default_value   : String(200);
        read_only       : Boolean     not null default false;
}

entity BPRolePrereqField : managed {
    key role            : Association to BPRole      not null;
    key field           : Association to FieldMaster not null;
        sequence        : Integer not null;
}

entity BPRoleDependency : managed {
    key role                : Association to BPRole not null;
    key prerequisite_role   : Association to BPRole not null;
        auto_pull           : Boolean not null default true;
}

entity AccountGroup : managed {
    key account_group_id    : String(10);
        description         : String(100)    not null;
        type                : AccountType    not null;
        number_range_id     : String(10)     not null;
        assignment_mode     : AssignmentMode not null;
        one_time            : Boolean        not null default false;
        active              : Boolean        not null default true;
        fields              : Composition of many AccountGroupField on fields.account_group = $self;
}

entity AccountGroupField : managed {
    key account_group   : Association to AccountGroup  not null;
    key field           : Association to FieldMaster   not null;
        field_status    : FieldStatus not null;
        sequence        : Integer     not null;
        default_value   : String(200);
}

// =============================================================================
//  LOOKUP ASPECTS
// =============================================================================

aspect LookupBase {
    key code            : String(20);
        description     : String(100) not null;
        active          : Boolean     not null default true;
        last_synced_at  : Timestamp   not null;
}

aspect LookupBaseComposite {
        description     : String(100) not null;
        active          : Boolean     not null default true;
        last_synced_at  : Timestamp   not null;
}

entity LK_CompanyCode   : LookupBase {}
entity LK_SalesOrg      : LookupBase {}
entity LK_DistChannel   : LookupBase {}
entity LK_Division      : LookupBase {}
entity LK_PurchOrg      : LookupBase {}
entity LK_PurchGroup    : LookupBase {}
entity LK_Plant         : LookupBase {}
entity LK_PaymentTerm   : LookupBase {}
entity LK_Country       : LookupBase {}
entity LK_Currency      : LookupBase {}
entity LK_Industry      : LookupBase {}
entity LK_MaterialType  : LookupBase {}
entity LK_MaterialGroup : LookupBase {}
entity LK_PriceGroup    : LookupBase {}
entity LK_SalesDistrict : LookupBase {}
entity LK_Incoterms     : LookupBase {}
entity LK_AcctAssmtGrp  : LookupBase {}
entity LK_TaxClass      : LookupBase {}
entity LK_PaymentMethod : LookupBase {}

entity LK_SalesArea : LookupBaseComposite {
    key sales_org       : String(10) not null;
    key dist_channel    : String(10) not null;
    key division        : String(10) not null;
}

entity LK_ReconAcct : LookupBase {
    key company_code    : String(10) not null;
}

entity LK_Region : LookupBase {
    key country         : String(10) not null;
}

entity LK_TaxCode : LookupBase {
    key country         : String(10) not null;
}

// =============================================================================
//  OPERATIONAL ENTITIES
// =============================================================================

entity ReplicationLog {
    key log_id          : UUID;
        entity_name     : String(40)       not null;
        started_at      : Timestamp        not null;
        finished_at     : Timestamp;
        status          : ReplicationStatus not null;
        rows_read       : Integer;
        rows_inserted   : Integer;
        rows_updated    : Integer;
        rows_deleted    : Integer;
        error_message   : String(1000);
}

entity StrategyCharacteristic : managed {
    key characteristic_id   : String(20);
        master_data_type    : Association to MasterDataType not null;
        description         : String(100)     not null;
        field               : Association to FieldMaster not null;
        data_type           : StrategyDataType not null;
        active              : Boolean          not null default true;
}

entity ReleaseCode : managed {
    key release_code_id     : String(10);
        description         : String(100) not null;
        master_data_type    : Association to MasterDataType;
        sla_hours           : Integer     not null;
        escalation_to       : String(80);
        escalation_hours    : Integer;
        active              : Boolean     not null default true;
        users               : Composition of many ReleaseCodeUser on users.release_code = $self;
        scopes              : Composition of many ReleaseCodeScope on scopes.release_code = $self;
}

entity ReleaseCodeUser : managed {
    key release_code    : Association to ReleaseCode not null;
    key user_id         : String(80)     not null;
        assignment_type : AssignmentType not null;
        active          : Boolean        not null default true;
}

entity ReleaseCodeScope : managed {
    key release_code    : Association to ReleaseCode not null;
    key scope_type      : ScopeType  not null;
    key scope_id        : String(40) not null;
}

entity ReleaseStrategy : managed {
    key strategy_id     : String(20);
        description     : String(100) not null;
        master_data_type : Association to MasterDataType not null;
        priority        : Integer     not null;
        active          : Boolean     not null default true;
        valid_from      : Date        not null;
        valid_to        : Date;
        values          : Composition of many ReleaseStrategyValue on values.strategy = $self;
        steps           : Composition of many ReleaseStrategyStep on steps.strategy = $self;
}

entity ReleaseStrategyValue : managed {
    key strategy        : Association to ReleaseStrategy        not null;
    key characteristic  : Association to StrategyCharacteristic not null;
        operator        : OperatorType not null;
        value_text      : String(200);
}

entity ReleaseStrategyStep : managed {
    key strategy        : Association to ReleaseStrategy not null;
    key step_number     : Integer not null;
        release_code    : Association to ReleaseCode not null;
        mandatory       : Boolean not null default true;
        parallel        : Boolean not null default false;
}

// FIX: CRPriority and CRStatus defined as types above
//      so default values can be set without parser errors
entity CRHeader : managed {
    key cr_id               : String(20);
        cr_group_id         : String(20)   not null;
        request_type        : CRRequestType not null;
        master_data_type    : Association to MasterDataType not null;
        scenario_code       : String(10)   not null;
        bp_category         : Association to BPCategory;
        account_group       : Association to AccountGroup;
        reference_object_no : String(20);
        requester           : String(80)   not null;
        priority            : CRPriority   not null default 'NORMAL';
        business_justification : String(2000);
        status              : CRStatus     not null default 'DRAFT';
        strategy            : Association to ReleaseStrategy;
        posted_object_no    : String(20);
        posted_at           : Timestamp;
        submitted_at        : Timestamp;
        bp_roles            : Composition of many CRBPRole on bp_roles.cr = $self;
        field_values        : Composition of many CRFieldValue on field_values.cr = $self;
        attachments         : Composition of many CRAttachment on attachments.cr = $self;
}

entity CRBPRole : managed {
    key cr              : Association to CRHeader not null;
    key role            : Association to BPRole   not null;
    key instance_no     : Integer not null default 1;
        instance_key_1  : String(40);
        instance_key_2  : String(40);
        instance_key_3  : String(40);
        instance_key_4  : String(40);
        auto_pulled     : Boolean not null default false;
}

entity CRFieldValue : managed {
    key cr              : Association to CRHeader    not null;
    key role_id         : String(10);
    key instance_no     : Integer not null default 1;
    key field           : Association to FieldMaster not null;
        old_value       : String(2000);
        new_value       : String(2000);
        source_level    : String(20) not null @assert.range enum { CATEGORY; ROLE; ACCOUNT_GROUP; };
}

entity CRAttachment : managed {
    key attachment_id   : UUID;
        cr              : Association to CRHeader not null;
        file_name       : String(200) not null;
        mime_type       : String(80)  not null;
        size_bytes      : Integer64   not null;
        object_store_uri : String(500) not null;
        description     : String(500);
        uploaded_by     : String(80)  not null;
        uploaded_at     : Timestamp   not null;
}

entity CRReleaseStrategy : managed {
    key cr              : Association to CRHeader        not null;
        strategy        : Association to ReleaseStrategy not null;
        determined_at   : Timestamp            not null;
        overall_status  : OverallApprovalStatus not null;
        current_step    : Integer              not null;
        completed_at    : Timestamp;
        steps           : Composition of many CRReleaseStep on steps.cr = $self;
}

entity CRReleaseStep : managed {
    key cr                      : Association to CRReleaseStrategy not null;
    key step_number             : Integer not null;
    key sequence_within_step    : Integer not null default 1;
        release_code            : Association to ReleaseCode not null;
        assigned_to             : String(80);
        status                  : StepStatus not null;
        due_at                  : Timestamp;
        acted_by                : String(80);
        acted_at                : Timestamp;
        comment                 : String(2000);
        escalated_at            : Timestamp;
}

entity CRApprovalDecision {
    key decision_id             : UUID;
        cr                      : Association to CRHeader    not null;
        step_number             : Integer        not null;
        sequence_within_step    : Integer        not null;
        release_code            : Association to ReleaseCode not null;
        action                  : ApprovalAction not null;
        acted_by                : String(80)     not null;
        acted_at                : Timestamp      not null;
        comment                 : String(2000);
        affected_groups         : String(500);
}

entity AuditLog {
    key audit_id        : UUID;
        entity_name     : String(60)  not null;
        entity_key      : String(200) not null;
        action          : AuditAction not null;
        actor           : String(80)  not null;
        acted_at        : Timestamp   not null;
        before_value    : LargeString;
        after_value     : LargeString;
        correlation_id  : String(40);
}

entity Notification : managed {
    key notification_id : UUID;
        cr              : Association to CRHeader;
        event_type      : NotificationEvent   not null;
        recipient       : String(200)         not null;
        channel         : NotificationChannel not null;
        subject         : String(200);
        body            : LargeString;
        status          : NotificationStatus  not null default 'PENDING';
        sent_at         : Timestamp;
        external_id     : String(80);
        error_message   : String(500);
}

// Add this to your data model
entity MetaDisplayType {
    key display_type_id: String(20);
    display_type_name: String(50);
    description: String(200);
    editable: Boolean;
    sortable: Boolean;
    filterable: Boolean;
    visible: Boolean;
    sequence: Integer;
    active: Boolean;
    created_at: Timestamp;
    created_by: String(100);
    modified_at: Timestamp;
    modified_by: String(100);
}

// =============================================================================
//  ANNOTATIONS
// =============================================================================

annotate MasterDataType with @(
    title: 'Master Data Type',
    UI.LineItem: [
        { Value: master_data_type_id, Label: 'Type' },
        { Value: description,         Label: 'Description' },
        { Value: object_class,        Label: 'Object Class' },
        { Value: active,              Label: 'Active' }
    ]
);

annotate CRHeader with @(
    title: 'Change Request',
    UI.LineItem: [
        { Value: cr_id,          Label: 'CR Number' },
        { Value: request_type,   Label: 'Type' },
        { Value: status,         Label: 'Status' },
        { Value: requester,      Label: 'Requester' },
        { Value: submitted_at,   Label: 'Submitted' },
        { Value: priority,       Label: 'Priority' }
    ]
);

annotate ReleaseCode     with @(title: 'Release Code');
annotate ReleaseStrategy with @(title: 'Release Strategy');
annotate BPRole          with @(title: 'BP Role');
annotate FieldMaster     with @(title: 'Field Master');

