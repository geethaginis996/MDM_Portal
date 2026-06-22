sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/IconTabFilter",
    "sap/m/Input",
    "sap/m/ComboBox",
    "sap/m/CheckBox",
    "sap/m/DatePicker",
    "sap/m/Label",
    "sap/m/Panel",
    "sap/m/VBox",
    "sap/m/Text",
    "sap/m/Table",
    "sap/m/Column",
    "sap/m/ColumnListItem",
    "sap/m/Button",
    "sap/m/SegmentedButton",
    "sap/m/SegmentedButtonItem",
    "sap/ui/unified/FileUploader",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, IconTabFilter, Input, ComboBox, CheckBox, DatePicker,
    Label, Panel, VBox, Text, Table, Column, ColumnListItem, Button, SegmentedButton, SegmentedButtonItem,
    FileUploader, Item, SimpleForm
) {
    "use strict";

    // Strongest field status wins when the same field comes from several roles.
    var STATUS_RANK = { REQUIRED: 3, OPTIONAL: 2, SUPPRESS: 1 };

    // Maps a field's SAP source table to the replicated reference-list service
    // entity that supplies its dropdown values. Extend as more lists are wired.
    var SOURCE_TO_LOOKUP = {
        T001  : "CompanyCodes",
        T001W : "Plants",
        TVKO  : "SalesOrgs",
        TVTW  : "DistChannels",
        TSPA  : "Divisions",
        T005  : "Countries",
        TCURC : "Currencies",
        T052  : "PaymentTerms",
        T016  : "Industries"
    };

    return Controller.extend("mdm.portal.controller.CreateBP", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oRt = new JSONModel(this._freshState());
            this.getView().setModel(this._oRt, "rt");

            this.getView().setModel(new JSONModel({ items: [] }), "cat");
            this.getView().setModel(new JSONModel({ items: [] }), "roles");
            this.getView().setModel(new JSONModel({ items: [] }), "ag");
            // Captures the dynamically generated field values, keyed by field_id.
            this.getView().setModel(new JSONModel({ values: {} }), "form");

            // group_id -> { description, icon, sequence } for tab labels/icons
            this._mGroups = {};
            // account_group_id -> { number_range_id, assignment_mode, type }
            this._mAccountGroups = {};
            // role_id -> { description, account_scope } for the Active Role bar
            this._mRoleMeta = {};
            // picked role_id -> [its own resolved prerequisite role_ids]
            this._mRolePrereqs = {};
            // role_id -> [{ field_id, description, display, data_type, ... }]
            // prerequisite fields that must be filled before main tabs unlock
            this._mRolePrereqFields = {};
            // IconTabFilter items for the regular (non-prereq) tabs — tracked so
            // they can be enabled/disabled when prereq completion changes
            this._aMainTabItems = [];
            // Full set of field assignments across every effective (selected +
            // prereq) role, cached so switching the active role re-filters in
            // memory instead of re-querying the service.
            this._aAllAssignments = [];

            this._loadLookups();

            this.getOwnerComponent().getRouter()
                .getRoute("createBP").attachPatternMatched(this._onRouteMatched, this);
        },

        _freshState: function () {
            return {
                mode             : "CREATE",
                status           : "New",
                subtitle         : "Select a BP role to generate the input form",
                started          : false,   // a category or existing BP has been chosen
                hasRoles         : false,   // at least one role selected -> tabs visible
                canSave          : false,
                categoryId       : "",
                extendBp         : "",
                roleKeys         : [],
                activeRole       : "",
                bpAgId           : "",
                bpNumber         : "",
                numberRange      : "\u2014",
                bpNumberEditable : false,
                bpNumberPlaceholder: "\u2014",
                bpNumberHelp     : "Will be set based on the selected role(s).",
                // header strip
                catDisp          : "\u2014",
                roleDisp         : "\u2014",
                bpAgDisp         : "\u2014",
                nrDisp           : "\u2014",
                preqDisp         : "\u2014"
            };
        },

        _onRouteMatched: function () {
            // Start every visit with a clean form.
            this._oRt.setData(this._freshState());
            this._aAllAssignments = [];
            this._mRolePrereqs = {};
            this._mRolePrereqFields = {};
            this._aMainTabItems = [];
            this.getView().getModel("form").setProperty("/values", {});
            var oTabs = this.byId("cbpTabs");
            if (oTabs) { oTabs.destroyItems(); }
            var oRoleBar = this.byId("cbpRoleBar");
            if (oRoleBar) { oRoleBar.destroyItems(); }
            var oMcb = this.byId("mcbRoles");
            if (oMcb) { oMcb.setSelectedKeys([]); }
        },

        // ── Load configuration lookups from the service ──────────────
        _loadLookups: function () {
            var oModel = this.getOwnerComponent().getModel();

            // BP Categories
            oModel.bindList("/BPCategories", null, [new Sorter("sequence")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 200).then(function (aCtx) {
                this.getView().getModel("cat").setProperty("/items", aCtx.map(function (c) {
                    return { key: c.getProperty("category_id"), text: c.getProperty("description") };
                }));
            }.bind(this)).catch(this._loadError("categories"));

            // BP Roles
            oModel.bindList("/BPRoles", null, [new Sorter("sequence")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 500).then(function (aCtx) {
                this._mRoleMeta = {};
                this.getView().getModel("roles").setProperty("/items", aCtx.map(function (c) {
                    var sId   = c.getProperty("role_id");
                    var sDesc = c.getProperty("description") || "";
                    this._mRoleMeta[sId] = {
                        description  : sDesc,
                        account_scope: c.getProperty("account_scope")
                    };
                    return { key: sId, text: sId + " — " + sDesc };
                }.bind(this)));
            }.bind(this)).catch(this._loadError("roles"));

            // Account Groups
            oModel.bindList("/AccountGroups", null, [new Sorter("account_group_id")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 500).then(function (aCtx) {
                var aItems = [];
                aCtx.forEach(function (c) {
                    var sId = c.getProperty("account_group_id");
                    this._mAccountGroups[sId] = {
                        number_range_id: c.getProperty("number_range_id"),
                        assignment_mode: c.getProperty("assignment_mode"),
                        type           : c.getProperty("type")
                    };
                    aItems.push({ key: sId, text: sId + " — " + (c.getProperty("description") || "") });
                }.bind(this));
                this.getView().getModel("ag").setProperty("/items", aItems);
            }.bind(this)).catch(this._loadError("account groups"));

            // Field Groups (for tab labels / icons)
            oModel.bindList("/FieldGroups", null, [new Sorter("sequence")])
                .requestContexts(0, 1000).then(function (aCtx) {
                    aCtx.forEach(function (c) {
                        this._mGroups[c.getProperty("group_id")] = {
                            description: c.getProperty("description") || c.getProperty("group_id"),
                            icon       : c.getProperty("icon") || "",
                            sequence   : c.getProperty("sequence") || 0
                        };
                    }.bind(this));
                }.bind(this)).catch(this._loadError("field groups"));

            // Field catalogue: field_id -> source_table. Loaded once and used to
            // resolve a field's value list, so dropdown population does not depend
            // on source_table surviving the per-role $expand (which can be dropped
            // by the OData entity cache if the field was loaded elsewhere first).
            this._mFieldSource = {};
            oModel.bindList("/FieldMasters", null, null, null, {
                $select: "field_id,source_table"
            }).requestContexts(0, 2000).then(function (aCtx) {
                aCtx.forEach(function (c) {
                    this._mFieldSource[c.getProperty("field_id")] = c.getProperty("source_table") || "";
                }.bind(this));
            }.bind(this)).catch(this._loadError("field catalogue"));
        },

        _loadError: function (sWhat) {
            return function (oErr) {
                MessageToast.show("Could not load " + sWhat + ": " + (oErr && oErr.message || "error"));
            };
        },

        // ── Step 0 handlers ──────────────────────────────────────────
        onCategoryChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sKey  = oItem ? oItem.getKey() : "";
            this._oRt.setProperty("/mode", "CREATE");
            this._oRt.setProperty("/categoryId", sKey);
            this._oRt.setProperty("/catDisp", oItem ? oItem.getText() : "\u2014");
            this._oRt.setProperty("/started", !!sKey);
            this._oRt.setProperty("/extendBp", "");
            if (sKey) {
                this._oRt.setProperty("/subtitle", "New BP \u00b7 select roles to generate the form");
            }
            this._recomputeCanSave();
        },

        onExtendSearch: function () {
            // The query-existing-extensions picker (BR-C17/C18) is a later module.
            MessageToast.show("Existing-BP search — coming soon");
        },

        onRolesChange: function (oEvent) {
            var aKeys = oEvent.getSource().getSelectedKeys() || [];
            this._oRt.setProperty("/roleKeys", aKeys);

            if (!aKeys.length) {
                this._oRt.setProperty("/roleDisp", "\u2014");
                this._mRolePrereqs = {};
                this._buildTabs([], []);
                this._recomputeCanSave();
                return;
            }

            // Pull in prerequisite roles (auto_pull = true) per picked role,
            // mirroring the wireframe ("Customer roles include BUP001 General") —
            // but fold each prerequisite's fields into the role that needed it
            // rather than giving the prerequisite its own Active Role button, so
            // the bar only ever shows roles you actually picked.
            this._resolvePrereqRoles(aKeys).then(function (aPairs) {
                this._mRolePrereqs = {};
                aKeys.forEach(function (k) { this._mRolePrereqs[k] = []; }.bind(this));

                var aPrereqKeys = [];
                aPairs.forEach(function (p) {
                    this._mRolePrereqs[p.role].push(p.prerequisite);
                    if (aPrereqKeys.indexOf(p.prerequisite) < 0) { aPrereqKeys.push(p.prerequisite); }
                }.bind(this));

                var aDisp = aKeys.slice();
                aPrereqKeys.forEach(function (k) {
                    if (aKeys.indexOf(k) < 0) { aDisp.push(k + " (prereq)"); }
                });
                this._oRt.setProperty("/roleDisp", aDisp.join(", "));

                // The OData query still needs every role's fields — picked roles
                // plus whichever prerequisites they pulled in — even though only
                // the picked roles get their own button in the Active Role bar.
                var aQueryRoles = aKeys.slice();
                aPrereqKeys.forEach(function (k) {
                    if (aQueryRoles.indexOf(k) < 0) { aQueryRoles.push(k); }
                });

                this._buildTabs(aQueryRoles, aKeys);
                this._recomputeCanSave();
            }.bind(this));
        },

        // Resolve auto-pull prerequisite roles for the selected roles, returned
        // as {role, prerequisite} pairs so each prerequisite can be folded into
        // the specific picked role that needed it.
        _resolvePrereqRoles: function (aKeys) {
            var oModel = this.getOwnerComponent().getModel();
            var aRoleFilters = aKeys.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oRolesFilter = aRoleFilters.length === 1
                ? aRoleFilters[0]
                : new Filter({ filters: aRoleFilters, and: false });
            var oFilter = new Filter({
                filters: [oRolesFilter, new Filter("auto_pull", FilterOperator.EQ, true)],
                and: true
            });
            return oModel.bindList("/BPRoleDependencies", null, null, [oFilter], {
                $select: "role_role_id,prerequisite_role_role_id,auto_pull"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                return aCtx.map(function (c) {
                    return {
                        role        : c.getProperty("role_role_id"),
                        prerequisite: c.getProperty("prerequisite_role_role_id")
                    };
                });
            }).catch(function () { return []; });
        },

        onBpAgChange: function (oEvent) {
            var oItem = oEvent.getParameter("selectedItem");
            var sKey  = oItem ? oItem.getKey() : "";
            this._oRt.setProperty("/bpAgId", sKey);
            this._oRt.setProperty("/bpAgDisp", oItem ? oItem.getText() : "\u2014");

            var oAg = this._mAccountGroups[sKey];
            if (oAg) {
                var sNr = oAg.number_range_id + " (" + oAg.assignment_mode + ")";
                this._oRt.setProperty("/numberRange", sNr);
                this._oRt.setProperty("/nrDisp", sNr);
                // External numbering -> requester types the number; internal -> generated on save.
                var bExternal = oAg.assignment_mode === "EXTERNAL";
                this._oRt.setProperty("/bpNumberEditable", bExternal);
                this._oRt.setProperty("/bpNumberPlaceholder", bExternal ? "Enter BP number" : "Generated on save");
                this._oRt.setProperty("/bpNumberHelp", bExternal
                    ? "External numbering — enter the BP number."
                    : "Internal numbering — generated on save.");
            } else {
                this._oRt.setProperty("/numberRange", "\u2014");
                this._oRt.setProperty("/nrDisp", "\u2014");
            }
            this._recomputeCanSave();
        },

        // ── Dynamic tab generation from the selected roles' fields ───
        // aQueryRoles: every role whose fields must be fetched (picked + their
        //   resolved prerequisites) — used only for the OData query.
        // aPickedRoles: roles the user actually selected — used for the Active
        //   Role bar, so prerequisites never get their own button.
        _buildTabs: function (aQueryRoles, aPickedRoles) {
            var oTabs = this.byId("cbpTabs");
            oTabs.destroyItems();

            if (!aQueryRoles.length) {
                this._oRt.setProperty("/hasRoles", false);
                this._oRt.setProperty("/activeRole", "");
                this._aAllAssignments = [];
                this._renderRoleBar([]);
                return;
            }
            this._oRt.setProperty("/hasRoles", true);

            var oModel = this.getOwnerComponent().getModel();
            var aRoleFilters = aQueryRoles.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oFilter = aRoleFilters.length === 1
                ? aRoleFilters[0]
                : new Filter({ filters: aRoleFilters, and: false });

            oModel.bindList("/BPRoleFields", null, [new Sorter("sequence")], [oFilter], {
                $expand: "field($select=field_id,description,data_type,display_type,length,source_table,main_group_group_id,sub_group_group_id;$expand=validation($select=validation_id,function_name,trigger_on,error_message,input_param_1,input_param_2,input_param_3))",
                $select: "role_role_id,field_field_id,field_status,sequence,read_only,default_value"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                // Cache as plain objects tagged with their source role, so switching
                // the Active Role re-filters in memory instead of re-querying.
                this._aAllAssignments = aCtx.map(function (c) {
                    return {
                        role       : c.getProperty("role_role_id"),
                        field_id   : c.getProperty("field_field_id"),
                        description: c.getProperty("field/description") || c.getProperty("field_field_id"),
                        data_type  : c.getProperty("field/data_type") || "STRING",
                        display    : c.getProperty("field/display_type") || "INPUT",
                        sourceTable: c.getProperty("field/source_table") || "",
                        mainGroup  : c.getProperty("field/main_group_group_id") || "OTHER",
                        subGroup   : c.getProperty("field/sub_group_group_id") || "",
                        status     : c.getProperty("field_status"),
                        readOnly   : c.getProperty("read_only") === true,
                        defaultVal : c.getProperty("default_value") || "",
                        sequence   : c.getProperty("sequence") || 0,
                        // Validation rule linked on Field Master (may be null)
                        valFn      : c.getProperty("field/validation/function_name") || "",
                        valTrigger : c.getProperty("field/validation/trigger_on") || "",
                        valMsg     : c.getProperty("field/validation/error_message") || "",
                        valParam1  : c.getProperty("field/validation/input_param_1") || "",
                        valParam2  : c.getProperty("field/validation/input_param_2") || ""
                    };
                });
                // Fetch prereq fields for all involved roles before rendering,
                // so both datasets are ready when the tab structure is built.
                return this._fetchPrereqFields(aQueryRoles);
            }.bind(this)).then(function () {
                this._setupActiveRole(aPickedRoles);
                this._renderRoleBar(aPickedRoles);
                this._renderTabsForActiveRole();
            }.bind(this)).catch(function (oErr) {
                MessageBox.error("Could not load fields for the selected roles: " +
                    (oErr && oErr.message || "error"));
            });
        },

        // Default the active role to a "general" (account_scope = BOTH) role when
        // one is present among the resolved roles, else the first one — mirroring
        // the wireframe. If the current active role is still in the resolved set
        // (e.g. roles changed but this one stayed selected), keep it as-is.
        _setupActiveRole: function (aRoleKeys) {
            var sCurrent = this._oRt.getProperty("/activeRole");
            if (sCurrent && aRoleKeys.indexOf(sCurrent) >= 0) { return; }

            var sGeneral = "";
            for (var i = 0; i < aRoleKeys.length; i++) {
                var oMeta = this._mRoleMeta[aRoleKeys[i]];
                if (oMeta && oMeta.account_scope === "BOTH") { sGeneral = aRoleKeys[i]; break; }
            }
            this._oRt.setProperty("/activeRole", sGeneral || aRoleKeys[0]);
        },

        // Fetch the prerequisite *fields* for every involved role and store them
        // in this._mRolePrereqFields[roleId] = [ plain-object per field ].
        // These are the fields the user must complete before the main tabs unlock.
        _fetchPrereqFields: function (aRoles) {
            if (!aRoles.length) {
                this._mRolePrereqFields = {};
                return Promise.resolve();
            }
            var oModel = this.getOwnerComponent().getModel();
            var aFilters = aRoles.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oFilter = aFilters.length === 1
                ? aFilters[0]
                : new Filter({ filters: aFilters, and: false });

            return oModel.bindList("/BPRolePrereqFields", null,
                [new Sorter("sequence")], [oFilter], {
                    $expand: "field($select=field_id,description,data_type,display_type,length,source_table)",
                    $select: "role_role_id,field_field_id,sequence"
                }
            ).requestContexts(0, 200).then(function (aCtx) {
                this._mRolePrereqFields = {};
                aCtx.forEach(function (c) {
                    var sRole = c.getProperty("role_role_id");
                    if (!this._mRolePrereqFields[sRole]) {
                        this._mRolePrereqFields[sRole] = [];
                    }
                    this._mRolePrereqFields[sRole].push({
                        field_id   : c.getProperty("field_field_id"),
                        description: c.getProperty("field/description") || c.getProperty("field_field_id"),
                        data_type  : c.getProperty("field/data_type") || "STRING",
                        display    : c.getProperty("field/display_type") || "INPUT",
                        sourceTable: c.getProperty("field/source_table") || "",
                        length     : c.getProperty("field/length") || 0,
                        status     : "REQUIRED",   // prereq fields are always required
                        readOnly   : false,
                        defaultVal : "",
                        sequence   : c.getProperty("sequence") || 0,
                        valFn: "", valTrigger: "", valMsg: "", valParam1: "", valParam2: ""
                    });
                }.bind(this));
            }.bind(this)).catch(function () {
                // Non-fatal: if the prereq endpoint fails, just proceed without gating
                this._mRolePrereqFields = {};
            }.bind(this));
        },

        // Segmented-button row for switching which role's fields are shown —
        // one button per role the user actually picked. Prerequisites never get
        // their own button; their fields are folded into whichever picked role
        // needed them (see _renderTabsForActiveRole).
        _renderRoleBar: function (aRoleKeys) {
            var oBar = this.byId("cbpRoleBar");
            oBar.destroyItems();
            aRoleKeys.forEach(function (k) {
                var oMeta = this._mRoleMeta[k] || {};
                oBar.addItem(new SegmentedButtonItem({
                    key : k,
                    text: k + " — " + (oMeta.description || k)
                }));
            }.bind(this));
            oBar.setSelectedKey(this._oRt.getProperty("/activeRole"));
        },

        onActiveRoleChange: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oRt.setProperty("/activeRole", sKey);
            this._renderTabsForActiveRole();
        },

        _renderTabsForActiveRole: function () {
            var oTabs = this.byId("cbpTabs");
            oTabs.destroyItems();

            var sActive = this._oRt.getProperty("/activeRole");
            // Include the active role's own fields plus any prerequisite roles
            // it pulled in (e.g. FLCU01's view also includes BUP001's fields) —
            // but not fields belonging only to some other picked role.
            var aIncludeRoles = [sActive].concat(this._mRolePrereqs[sActive] || []);
            var aCtx = this._aAllAssignments.filter(function (a) {
                return aIncludeRoles.indexOf(a.role) >= 0;
            });

            // 1) Keep the strongest status per field (within one role each
            // field appears at most once, so this is mostly a pass-through).
            var mFields = {};
            aCtx.forEach(function (f) {
                if (f.status === "SUPPRESS") { return; }             // hidden from the form
                var oExisting = mFields[f.field_id];
                if (oExisting && STATUS_RANK[oExisting.status] >= STATUS_RANK[f.status]) { return; }
                mFields[f.field_id] = f;
            });

            // 2) Group by main group, then sub group.
            var mMain = {};
            Object.keys(mFields).forEach(function (sFid) {
                var f = mFields[sFid];
                (mMain[f.mainGroup] = mMain[f.mainGroup] || []).push(f);
            });

            // 3) Seed the form value model with defaults.
            var oFormModel = this.getView().getModel("form");
            var mValues = {};
            Object.keys(mFields).forEach(function (sFid) { mValues[sFid] = mFields[sFid].defaultVal; });
            oFormModel.setProperty("/values", mValues);

            // 4) Order main groups by their configured sequence.
            var aMainIds = Object.keys(mMain).sort(function (a, b) {
                var sa = (this._mGroups[a] && this._mGroups[a].sequence) || 0;
                var sb = (this._mGroups[b] && this._mGroups[b].sequence) || 0;
                return sa - sb;
            }.bind(this));

            var iTotal = 0;
            this._aMainTabItems = [];     // reset for this render pass

            // ── Prerequisites tab (always first, when the role has prereq fields) ──
            var aPrereqFields = this._mRolePrereqFields[sActive] || [];
            if (aPrereqFields.length) {
                var oPrereqForm = new SimpleForm({
                    editable: true,
                    layout: "ResponsiveGridLayout",
                    labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4, labelSpanS: 12,
                    columnsXL: 2, columnsL: 2, columnsM: 1
                });
                aPrereqFields.forEach(function (f) {
                    oPrereqForm.addContent(new Label({ text: f.description, required: true }));
                    var oCtrl = this._fieldControl(f);
                    var fnCheck = function () { setTimeout(this._checkAndGateTabs.bind(this), 0); }.bind(this);
                    if (oCtrl.attachChange)     { oCtrl.attachChange(fnCheck); }
                    if (oCtrl.attachLiveChange) { oCtrl.attachLiveChange(fnCheck); }
                    oPrereqForm.addContent(oCtrl);
                }.bind(this));

                var oPrereqPanel = new Panel({
                    headerText: "Required before proceeding (" + aPrereqFields.length +
                                " field" + (aPrereqFields.length > 1 ? "s" : "") + ")",
                    expandable: false, expanded: true, content: [oPrereqForm]
                });
                oPrereqPanel.addStyleClass("sapUiNoContentPadding");

                var oPrereqBanner = new sap.m.MessageStrip({
                    text: "Fill in the prerequisite fields below — the data tabs unlock once all are completed.",
                    type: "Information", showIcon: true
                });
                oPrereqBanner.addStyleClass("sapUiSmallMarginBottom");

                oTabs.addItem(new IconTabFilter({
                    key: "__prereqs", text: "Prerequisites",
                    icon: "sap-icon://key", count: String(aPrereqFields.length),
                    content: [new VBox({ items: [oPrereqBanner, oPrereqPanel] })]
                }));
            }

            aMainIds.forEach(function (sMain) {
                var oGrpMeta = this._mGroups[sMain] || {};
                var aFields  = mMain[sMain].sort(function (a, b) { return a.sequence - b.sequence; });
                iTotal += aFields.length;

                var aBuckets   = [];
                var mBucketIdx = {};
                aFields.forEach(function (f) {
                    var sKey = f.subGroup || f.mainGroup;
                    if (mBucketIdx[sKey] === undefined) {
                        mBucketIdx[sKey] = aBuckets.length;
                        aBuckets.push({ key: sKey, fields: [] });
                    }
                    aBuckets[mBucketIdx[sKey]].fields.push(f);
                });

                var oTabContent = new VBox();
                aBuckets.forEach(function (oBucket, iIdx) {
                    var oForm = new SimpleForm({
                        editable: true,
                        layout: "ResponsiveGridLayout",
                        labelSpanXL: 4, labelSpanL: 4, labelSpanM: 4, labelSpanS: 12,
                        columnsXL: 2, columnsL: 2, columnsM: 1
                    });
                    oBucket.fields.forEach(function (f) {
                        oForm.addContent(new Label({ text: f.description, required: f.status === "REQUIRED" }));
                        oForm.addContent(this._fieldControl(f));
                    }.bind(this));

                    var oSubMeta = this._mGroups[oBucket.key] || {};
                    var oPanel = new Panel({
                        headerText: (oSubMeta.description || oBucket.key) + " (" + oBucket.fields.length + ")",
                        expandable: true, expanded: iIdx === 0, content: [oForm]
                    });
                    oPanel.addStyleClass("sapUiSmallMarginBottom");
                    oPanel.addStyleClass("sapUiNoContentPadding");
                    oTabContent.addItem(oPanel);
                }.bind(this));

                var oTab = new IconTabFilter({
                    key: sMain, text: oGrpMeta.description || sMain,
                    count: String(aFields.length), icon: oGrpMeta.icon || "sap-icon://form",
                    content: [oTabContent]
                });
                this._aMainTabItems.push(oTab);
                oTabs.addItem(oTab);
            }.bind(this));

            this._oRt.setProperty("/preqDisp", iTotal + " field" + (iTotal !== 1 ? "s" : ""));

            var oAttsTab = this._buildAttachmentsTab();
            this._aMainTabItems.push(oAttsTab);
            oTabs.addItem(oAttsTab);

            // Gate main tabs on first render — unlock immediately if all prereqs
            // are already filled (e.g. user switched roles and came back).
            this._checkAndGateTabs();
        },

        // Checks whether every prerequisite field for the active role has a value,
        // then enables or disables all main tabs accordingly.
        _checkAndGateTabs: function () {
            var bComplete = this._arePrereqsComplete();
            this._aMainTabItems.forEach(function (oTab) {
                oTab.setEnabled(bComplete);
            });
            // If prereqs just became complete, auto-navigate to the first main tab.
            if (bComplete && this._aMainTabItems.length) {
                var oTabs = this.byId("cbpTabs");
                var sFirst = this._aMainTabItems[0].getKey();
                if (oTabs.getSelectedKey() === "__prereqs") {
                    oTabs.setSelectedKey(sFirst);
                }
            }
        },

        _arePrereqsComplete: function () {
            var sActive = this._oRt.getProperty("/activeRole");
            var aPrereqs = this._mRolePrereqFields[sActive] || [];
            if (!aPrereqs.length) { return true; }   // no prereqs → always unlocked
            var mValues = this.getView().getModel("form").getProperty("/values") || {};
            return aPrereqs.every(function (f) {
                var v = mValues[f.field_id];
                return v !== undefined && v !== null && String(v).trim() !== "";
            });
        },

        // ── Attachments tab ─────────────────────────────────────────────
        // Client-side only for now: captures real file name/size via the
        // browser's native picker, but there is no backend entity/endpoint
        // yet to actually persist or upload these when the BP is saved.
        _buildAttachmentsTab: function () {
            if (!this._oAttsModel) {
                this._oAttsModel = new JSONModel({ items: [] });
                this.getView().setModel(this._oAttsModel, "atts");
            }
            var aExisting = this._oAttsModel.getProperty("/items");

            var oUploader = new FileUploader({
                buttonOnly: true,
                buttonText: "Browse Files",
                icon: "sap-icon://upload",
                multiple: true,
                change: this._onFilesSelected.bind(this)
            });
            oUploader.addStyleClass("sapUiSmallMarginBottom");

            var oTable = new Table({
                noDataText: "No attachments yet.",
                columns: [
                    new Column({ header: new Label({ text: "File" }) }),
                    new Column({ header: new Label({ text: "Size" }), hAlign: "End", width: "6rem" }),
                    new Column({ width: "3rem", hAlign: "End" })
                ],
                items: {
                    path: "atts>/items",
                    template: new ColumnListItem({
                        cells: [
                            new Text({ text: "{atts>name}" }),
                            new Text({ text: "{atts>size}" }),
                            new Button({
                                icon: "sap-icon://decline",
                                type: "Transparent",
                                tooltip: "Remove",
                                press: this._onRemoveAttachment.bind(this)
                            })
                        ]
                    })
                }
            });

            var oIntro = new Text({
                text: "Attach supporting documents for this request — e.g. company registration, VAT certificate, signed authorisation."
            });
            oIntro.addStyleClass("sapUiSmallMarginBottom");

            var oContent = new VBox({
                items: [oIntro, oUploader, oTable]
            });
            oContent.addStyleClass("sapUiSmallMargin");

            this._oAttachmentsTab = new IconTabFilter({
                key  : "__attachments",
                text : "Attachments",
                icon : "sap-icon://attachment",
                count: aExisting.length ? String(aExisting.length) : "",
                content: [oContent]
            });
            return this._oAttachmentsTab;
        },

        _onFilesSelected: function (oEvent) {
            var aFiles = oEvent.getParameter("files");
            if (!aFiles || !aFiles.length) { return; }
            var aItems = this._oAttsModel.getProperty("/items").slice();
            for (var i = 0; i < aFiles.length; i++) {
                aItems.push({ name: aFiles[i].name, size: this._formatFileSize(aFiles[i].size) });
            }
            this._oAttsModel.setProperty("/items", aItems);
            this._oAttachmentsTab.setCount(String(aItems.length));
        },

        _onRemoveAttachment: function (oEvent) {
            var sPath = oEvent.getSource().getBindingContext("atts").getPath();
            var iIdx  = parseInt(sPath.split("/").pop(), 10);
            var aItems = this._oAttsModel.getProperty("/items").slice();
            aItems.splice(iIdx, 1);
            this._oAttsModel.setProperty("/items", aItems);
            this._oAttachmentsTab.setCount(aItems.length ? String(aItems.length) : "");
        },

        _formatFileSize: function (iBytes) {
            if (iBytes < 1024) { return iBytes + " B"; }
            if (iBytes < 1024 * 1024) { return Math.round(iBytes / 1024) + " KB"; }
            return (iBytes / (1024 * 1024)).toFixed(1) + " MB";
        },

        // ── Validation engine ────────────────────────────────────────
        // Runs the function referenced by the ValidationRule linked to a field.
        // Returns null when the value is valid, an error string when it's not.
        _runValidation: function (f, sValue) {
            if (!f.valFn) { return null; }
            var v = (sValue === undefined || sValue === null) ? "" : String(sValue);

            switch (f.valFn) {
                case "checkRequired":
                    return v.trim() ? null : (f.valMsg || "This field is required.");

                case "checkNumeric":
                    return /^-?\d+(\.\d+)?$/.test(v.trim()) ? null
                        : (f.valMsg || "Only numeric values are allowed.");

                case "checkEmailFormat":
                    if (!v.trim()) { return null; }   // empty = let Required handle it
                    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? null
                        : (f.valMsg || "Invalid email format.");

                case "checkDateRange":
                    if (!v.trim()) { return null; }
                    var oDate = new Date(v);
                    var oToday = new Date();
                    oToday.setHours(0, 0, 0, 0);
                    if (f.valParam1 === "today" && oDate < oToday) {
                        return f.valMsg || "Date must not be in the past.";
                    }
                    return null;

                default:
                    return null;   // unknown function — pass silently
            }
        },

        // Build the right input control for a field's display type.
        _fieldControl: function (f) {
            var sPath = "{form>/values/" + f.field_id + "}";
            var bEditable = !f.readOnly;

            if (f.display === "CHECKBOX" || f.data_type === "BOOLEAN") {
                return new CheckBox({ selected: sPath, editable: bEditable });
            }
            if (f.display === "DATEPICKER" || f.display === "DATE_PICKER" || f.data_type === "DATE") {
                return new DatePicker({ value: sPath, editable: bEditable, width: "100%" });
            }
            if (f.display === "DROPDOWN" || f.display === "SEARCH_HELP") {
                var sSource    = (this._mFieldSource && this._mFieldSource[f.field_id]) || f.sourceTable;
                var sEntitySet = SOURCE_TO_LOOKUP[sSource];
                if (sEntitySet) {
                    // A reference list backs this field -> real dropdown of values.
                    var oCombo = new ComboBox({
                        selectedKey: sPath, editable: bEditable, width: "100%",
                        placeholder: "Select…"
                    });
                    this._loadValueList(sEntitySet).then(function (aVals) {
                        aVals.forEach(function (v) {
                            oCombo.addItem(new Item({ key: v.code, text: v.text }));
                        });
                    }).catch(function () { /* leave empty on load failure */ });
                    return oCombo;
                }
                if (f.display === "DROPDOWN") {
                    // Configured as a dropdown but no value list is mapped yet —
                    // still render a dropdown control (empty) rather than a textbox.
                    return new ComboBox({
                        selectedKey: sPath, editable: bEditable, width: "100%",
                        placeholder: "No value list configured"
                    });
                }
                // SEARCH_HELP without a mapped list -> value-help input.
                return new Input({
                    value: sPath, editable: bEditable, width: "100%",
                    showValueHelp: true,
                    valueHelpRequest: function () { MessageToast.show("Value help — coming soon"); }
                });
            }
            var oInput = new Input({
                value: sPath, editable: bEditable, width: "100%",
                type: f.data_type === "INTEGER" || f.data_type === "DECIMAL" ? "Number" : "Text",
                maxLength: f.length || 0
            });
            // Apply FIELD-trigger validation live as the user types.
            if (f.valFn && f.valTrigger === "FIELD") {
                oInput.attachLiveChange(function (oEv) {
                    var sVal = oEv.getParameter("value");
                    var sErr = this._runValidation(f, sVal);
                    oEv.getSource().setValueState(sErr ? "Error" : "None");
                    oEv.getSource().setValueStateText(sErr || "");
                }.bind(this));
            }
            return oInput;
        },

        // Load (and cache) a reference list's values for dropdowns.
        _loadValueList: function (sEntitySet) {
            this._mValueCache = this._mValueCache || {};
            if (this._mValueCache[sEntitySet]) { return this._mValueCache[sEntitySet]; }

            var oModel = this.getOwnerComponent().getModel();
            var p = oModel.bindList("/" + sEntitySet, null, [new Sorter("code")], [
                new Filter("active", FilterOperator.EQ, true)
            ]).requestContexts(0, 1000).then(function (aCtx) {
                return aCtx.map(function (c) {
                    var sCode = c.getProperty("code");
                    return { code: sCode, text: sCode + " — " + (c.getProperty("description") || "") };
                });
            });
            this._mValueCache[sEntitySet] = p;
            return p;
        },

        // ── Save / cancel ────────────────────────────────────────────
        _recomputeCanSave: function () {
            var bOk = this._oRt.getProperty("/started")
                && (this._oRt.getProperty("/roleKeys") || []).length > 0
                && !!this._oRt.getProperty("/bpAgId");
            this._oRt.setProperty("/canSave", bOk);
        },

        onSaveDraft: function () {
            // Persisting to CRHeader/CRFieldValue is the next build step; this
            // confirms the form state is captured correctly in the meantime.
            MessageToast.show("Saved as draft (request persistence is the next step).");
        },

        onSaveCreate: function () {
            var aMissing = this._validateRequired();
            if (aMissing.length) {
                MessageBox.warning("Please complete the required fields:\n\n" + aMissing.join("\n"));
                return;
            }
            MessageToast.show("Validated — submitting to the approval workflow is the next step.");
        },

        _validateRequired: function () {
            var aErrors = [];
            var oValues = this.getView().getModel("form").getProperty("/values") || {};

            // Build a quick lookup: field_id -> assignment object, for the currently
            // active role's visible fields (same slice _renderTabsForActiveRole uses).
            var sActive = this._oRt.getProperty("/activeRole");
            var aInclude = [sActive].concat(this._mRolePrereqs[sActive] || []);
            var mActive = {};
            this._aAllAssignments.forEach(function (a) {
                if (aInclude.indexOf(a.role) < 0) { return; }
                if (a.status === "SUPPRESS") { return; }
                var oEx = mActive[a.field_id];
                if (oEx && STATUS_RANK[oEx.status] >= STATUS_RANK[a.status]) { return; }
                mActive[a.field_id] = a;
            });

            Object.keys(mActive).forEach(function (sFid) {
                var f   = mActive[sFid];
                var sVal = oValues[sFid];
                var sStr = (sVal === undefined || sVal === null) ? "" : String(sVal);

                // 1) Required-status check (always).
                if (f.status === "REQUIRED" && !sStr.trim()) {
                    aErrors.push("\u2022 " + f.description + " is required.");
                    return;   // skip further validation if already empty+required
                }

                // 2) SAVE-trigger validation rule (only if a value exists).
                if (f.valFn && f.valTrigger === "SAVE" && sStr.trim()) {
                    var sErr = this._runValidation(f, sVal);
                    if (sErr) { aErrors.push("\u2022 " + f.description + ": " + sErr); }
                }
            }.bind(this));

            return aErrors;
        },

        onCancel: function () {
            var bDirty = this._oRt.getProperty("/started");
            var fnGo = function () {
                this._onRouteMatched();
                this.getOwnerComponent().getRouter().navTo("fieldMaster");
            }.bind(this);
            if (bDirty) {
                MessageBox.confirm("Discard this request?", {
                    onClose: function (sAction) { if (sAction === MessageBox.Action.OK) { fnGo(); } }
                });
            } else {
                fnGo();
            }
        }
    });
});