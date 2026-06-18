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
    "sap/ui/unified/FileUploader",
    "sap/ui/core/Item",
    "sap/ui/layout/form/SimpleForm"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, IconTabFilter, Input, ComboBox, CheckBox, DatePicker,
    Label, Panel, VBox, Text, Table, Column, ColumnListItem, Button, FileUploader,
    Item, SimpleForm
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
            this.getView().getModel("form").setProperty("/values", {});
            var oTabs = this.byId("cbpTabs");
            if (oTabs) { oTabs.destroyItems(); }
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
                this.getView().getModel("roles").setProperty("/items", aCtx.map(function (c) {
                    var sId = c.getProperty("role_id");
                    return { key: sId, text: sId + " — " + (c.getProperty("description") || "") };
                }));
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
                this._buildTabs([]);
                this._recomputeCanSave();
                return;
            }

            // Pull in prerequisite roles (auto_pull = true) and merge their fields,
            // mirroring the wireframe ("Customer roles include BUP001 General").
            this._resolvePrereqRoles(aKeys).then(function (aPrereq) {
                var aEffective = aKeys.slice();
                aPrereq.forEach(function (k) {
                    if (aEffective.indexOf(k) < 0) { aEffective.push(k); }
                });

                var aDisp = aKeys.slice();
                aPrereq.forEach(function (k) {
                    if (aKeys.indexOf(k) < 0) { aDisp.push(k + " (prereq)"); }
                });
                this._oRt.setProperty("/roleDisp", aDisp.join(", "));

                this._buildTabs(aEffective);
                this._recomputeCanSave();
            }.bind(this));
        },

        // Resolve auto-pull prerequisite roles for the selected roles.
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
                return aCtx.map(function (c) { return c.getProperty("prerequisite_role_role_id"); });
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
        _buildTabs: function (aRoleKeys) {
            var oTabs = this.byId("cbpTabs");
            oTabs.destroyItems();

            if (!aRoleKeys.length) {
                this._oRt.setProperty("/hasRoles", false);
                return;
            }
            this._oRt.setProperty("/hasRoles", true);

            var oModel = this.getOwnerComponent().getModel();
            var aRoleFilters = aRoleKeys.map(function (k) {
                return new Filter("role_role_id", FilterOperator.EQ, k);
            });
            var oFilter = aRoleFilters.length === 1
                ? aRoleFilters[0]
                : new Filter({ filters: aRoleFilters, and: false });

            oModel.bindList("/BPRoleFields", null, [new Sorter("sequence")], [oFilter], {
                $expand: "field($select=field_id,description,data_type,display_type,length,source_table,main_group_group_id,sub_group_group_id)",
                $select: "role_role_id,field_field_id,field_status,sequence,read_only,default_value"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                this._renderTabs(aCtx);
            }.bind(this)).catch(function (oErr) {
                MessageBox.error("Could not load fields for the selected roles: " +
                    (oErr && oErr.message || "error"));
            });
        },

        _renderTabs: function (aCtx) {
            // 1) Deduplicate fields across roles, keeping the strongest status.
            var mFields = {};
            aCtx.forEach(function (c) {
                var sStatus = c.getProperty("field_status");
                if (sStatus === "SUPPRESS") { return; }             // hidden from the form
                var sFid = c.getProperty("field_field_id");
                var oExisting = mFields[sFid];
                if (oExisting && STATUS_RANK[oExisting.status] >= STATUS_RANK[sStatus]) { return; }
                mFields[sFid] = {
                    field_id   : sFid,
                    description: c.getProperty("field/description") || sFid,
                    data_type  : c.getProperty("field/data_type") || "STRING",
                    display    : c.getProperty("field/display_type") || "INPUT",
                    sourceTable: c.getProperty("field/source_table") || "",
                    mainGroup  : c.getProperty("field/main_group_group_id") || "OTHER",
                    subGroup   : c.getProperty("field/sub_group_group_id") || "",
                    status     : sStatus,
                    readOnly   : !!c.getProperty("read_only"),
                    defaultVal : c.getProperty("default_value") || "",
                    sequence   : c.getProperty("sequence") || 0
                };
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

            var oTabs = this.byId("cbpTabs");
            var iTotal = 0;
            aMainIds.forEach(function (sMain) {
                var oGrpMeta = this._mGroups[sMain] || {};
                var aFields  = mMain[sMain].sort(function (a, b) { return a.sequence - b.sequence; });
                iTotal += aFields.length;

                // Bucket this main group's fields by sub-group so related fields sit
                // in their own clearly-labelled, collapsible section — mirroring the
                // wireframe's sub-group panels — instead of one continuous form with
                // small inline headings that were easy to miss.
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
                        oForm.addContent(new Label({
                            text: f.description,
                            required: f.status === "REQUIRED"
                        }));
                        oForm.addContent(this._fieldControl(f));
                    }.bind(this));

                    var oSubMeta = this._mGroups[oBucket.key] || {};
                    var oPanel = new Panel({
                        headerText: (oSubMeta.description || oBucket.key) + " (" + oBucket.fields.length + ")",
                        expandable: true,
                        expanded  : iIdx === 0,
                        content   : [oForm]
                    });
                    oPanel.addStyleClass("sapUiSmallMarginBottom");
                    oTabContent.addItem(oPanel);
                }.bind(this));

                oTabs.addItem(new IconTabFilter({
                    key  : sMain,
                    text : oGrpMeta.description || sMain,
                    count: String(aFields.length),
                    icon : oGrpMeta.icon || "sap-icon://form",
                    content: [oTabContent]
                }));
            }.bind(this));

            this._oRt.setProperty("/preqDisp", iTotal + " field" + (iTotal !== 1 ? "s" : ""));

            // Always-on Attachments tab, independent of role/field selection — the
            // underlying "atts" model is created once and reused, so anything
            // already attached survives this tab rebuild (e.g. after changing roles).
            oTabs.addItem(this._buildAttachmentsTab());
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
            return new Input({
                value: sPath, editable: bEditable, width: "100%",
                type: f.data_type === "INTEGER" || f.data_type === "DECIMAL" ? "Number" : "Text",
                maxLength: f.length || 0
            });
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
            // Walk the generated tabs and collect empty required fields.
            var aMissing = [];
            var oValues = this.getView().getModel("form").getProperty("/values") || {};
            var oTabs = this.byId("cbpTabs");
            oTabs.getItems().forEach(function (oTab) {
                (oTab.getContent() || []).forEach(function (oForm) {
                    if (!oForm.getContent) { return; }
                    var aC = oForm.getContent();
                    for (var i = 0; i < aC.length; i++) {
                        var oc = aC[i];
                        if (oc.isA && oc.isA("sap.m.Label") && oc.getRequired()) {
                            // The control bound right after the label holds the value.
                            var oField = aC[i + 1];
                            var sBound = oField && oField.getBindingPath &&
                                (oField.getBindingPath("value") || oField.getBindingPath("selected"));
                            var sFid = sBound ? sBound.split("/").pop() : null;
                            if (sFid && (oValues[sFid] === undefined || oValues[sFid] === null || oValues[sFid] === "")) {
                                aMissing.push("\u2022 " + oc.getText());
                            }
                        }
                    }
                });
            });
            return aMissing;
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