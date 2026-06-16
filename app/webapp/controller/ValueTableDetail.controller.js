sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/core/format/DateFormat"
], function (
    Controller, JSONModel, Filter, FilterOperator, Sorter,
    MessageToast, MessageBox, DateFormat
) {
    "use strict";

    var oDateFmt = DateFormat.getDateTimeInstance({ style: "medium" });

    return Controller.extend("mdm.portal.controller.ValueTableDetail", {

        // ── Lifecycle ────────────────────────────────────────────────
        onInit: function () {
            this._oViewModel = new JSONModel({
                busy        : false,
                isNew       : false,
                isDirty     : false,
                selectedTab : "general",
                usageCount  : "0"
            });
            this.getView().setModel(this._oViewModel, "view");

            // Usage list held in a JSON model (loaded on demand)
            this.getView().setModel(new JSONModel({ items: [] }), "usage");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("valueTableDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        // ── Route matched ────────────────────────────────────────────
        _onRouteMatched: function (oEvent) {
            var sId = decodeURIComponent(oEvent.getParameter("arguments").valueTableId);

            this._oViewModel.setProperty("/isDirty", false);
            this._oViewModel.setProperty("/selectedTab", "general");
            this.byId("detailTabs").setSelectedKey("general");
            this.getView().getModel("usage").setProperty("/items", []);

            if (sId === "NEW") {
                this._createNew();
            } else {
                this._bindValueTable(sId);
            }
        },

        // ── Bind existing ────────────────────────────────────────────
        _bindValueTable: function (sId) {
            this._oViewModel.setProperty("/isNew", false);
            this._oViewModel.setProperty("/busy",  true);

            var sPath = "/ValueTables('" + sId + "')";
            this.getView().bindObject({
                path      : sPath,
                parameters: {
                    $$updateGroupId: "valueTableUpdate"
                },
                events: {
                    dataReceived: function (oEvt) {
                        this._oViewModel.setProperty("/busy", false);

                        var oError = oEvt.getParameter("error");
                        if (oError) {
                            MessageBox.error("Could not load value table: " + (oError.message || "Unknown error"));
                            return;
                        }

                        var oCtx = this.getView().getBindingContext();
                        if (!oCtx) {
                            MessageToast.show("Value table not found");
                            this.onNavBack();
                            return;
                        }
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                        // ID is the key — not editable on existing record
                        this.byId("inId").setEditable(false);
                    }.bind(this)
                }
            });
        },

        // ── Create new ───────────────────────────────────────────────
        _createNew: function () {
            this._oViewModel.setProperty("/isNew", true);
            this._oViewModel.setProperty("/busy",  false);

            var oModel = this.getOwnerComponent().getModel();
            // Bind list to the SAME update group submitBatch uses
            var oListBinding = oModel.bindList("/ValueTables", null, [], [], {
                $$updateGroupId: "valueTableUpdate"
            });
            var oContext = oListBinding.create({
                value_table_id: "",
                description   : "",
                source_table  : "",
                input_1       : null,
                input_2       : null,
                input_3       : null,
                output_key    : "",
                output_desc   : "",
                status        : "ACTIVE"
            });
            this._oCreateListBinding = oListBinding;
            this.getView().setBindingContext(oContext);
            this._refreshHeader({ value_table_id: "", description: "", status: "ACTIVE" });
            this.byId("inId").setEditable(true);
        },

        // ── Header refresh ────────────────────────────────────────────
        _refreshHeader: function (oData) {
            var sId   = oData.value_table_id || "";
            var sDesc = oData.description || "";
            var sTitle = sId ? (sId + (sDesc ? " — " + sDesc : "")) : "New Value Table";

            this.byId("pageTitle").setText(sTitle);

            var oBreadcrumb = this.byId("pageBreadcrumb");
            if (oBreadcrumb) {
                oBreadcrumb.setCurrentLocationText(sId || "New Value Table");
            }

            var bActive = oData.status === "ACTIVE";
            this.byId("pageSubtitle").setText(
                "Value table" + (oData.source_table ? " · source " + oData.source_table : "")
            );
            this.byId("attrStatus").setText(bActive ? "Active" : "Inactive");
            this.byId("attrStatus").setState(bActive ? "Success" : "Error");
            this.byId("attrSource").setText(oData.source_table || "—");
        },

        // ── Dirty flag ───────────────────────────────────────────────
        onFieldChange: function () {
            this._oViewModel.setProperty("/isDirty", true);
        },

        onStatusChange: function (oEvent) {
            // Write the new status straight into the bound context so the
            // (read-only) expression binding stays in sync and the value is
            // actually part of the pending changes when Save runs.
            var bOn  = oEvent.getParameter("state");
            var oCtx = this.getView().getBindingContext();
            if (oCtx) {
                oCtx.setProperty("status", bOn ? "ACTIVE" : "INACTIVE");
            }
            this._oViewModel.setProperty("/isDirty", true);
        },

        // ── Tab select ───────────────────────────────────────────────
        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            this._oViewModel.setProperty("/selectedTab", sKey);
            if (sKey === "usage")     { this._loadUsage(); }
            if (sKey === "changelog") { this._loadChangeLog(); }
        },

        // ── Usage tab ────────────────────────────────────────────────
        _loadUsage: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("value_table_id");
            if (!sId) { return; }

            var oModel = this.getOwnerComponent().getModel();
            oModel.bindList("/FieldMasters", null, [new Sorter("field_id")], [
                new Filter("value_table_value_table_id", FilterOperator.EQ, sId)
            ], {
                $select: "field_id,description,display_type,active,main_group_group_id,sub_group_group_id,value_table_value_table_id"
            }).requestContexts(0, Infinity).then(function (aCtx) {
                var aItems = aCtx.map(function (c) {
                    return {
                        field_id    : c.getProperty("field_id"),
                        description : c.getProperty("description"),
                        display_type: c.getProperty("display_type"),
                        main_group  : c.getProperty("main_group_group_id"),
                        sub_group   : c.getProperty("sub_group_group_id"),
                        active      : c.getProperty("active")
                    };
                });
                this.getView().getModel("usage").setProperty("/items", aItems);
                this._oViewModel.setProperty("/usageCount", String(aItems.length));
                this.byId("attrUsage").setText(aItems.length + " field" + (aItems.length !== 1 ? "s" : ""));
            }.bind(this)).catch(function (e) {
                MessageBox.error("Could not load usage: " + e.message);
            });
        },

        onUsageRowPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId)
            });
        },

        onUsageLinkPress: function (oEvent) {
            var sFieldId = oEvent.getSource().getBindingContext("usage").getProperty("field_id");
            this.getOwnerComponent().getRouter().navTo("fieldMasterDetail", {
                fieldId: encodeURIComponent(sFieldId)
            });
        },

        // ── Change log tab ───────────────────────────────────────────
        _loadChangeLog: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) { return; }
            var sId = oCtx.getProperty("value_table_id");
            if (!sId) { return; }

            var oTable   = this.byId("logTable");
            var oBinding = oTable.getBinding("items");
            if (!oBinding) { return; }
            oBinding.filter([
                new Filter("entity_name", FilterOperator.EQ, "ValueTable"),
                new Filter("entity_key",  FilterOperator.EQ, sId)
            ]);
            oBinding.resume();
        },

        // ── Save ─────────────────────────────────────────────────────
        onSave: function () {
            var sId         = this.byId("inId").getValue().trim().toUpperCase();
            var sDesc       = this.byId("inDescription").getValue().trim();
            var sSource     = this.byId("inSourceTable").getValue().trim();
            var sOutputKey  = this.byId("inOutputKey").getValue().trim();
            var sOutputDesc = this.byId("inOutputDesc").getValue().trim();

            // Validation
            if (!sId) {
                MessageBox.error("Table ID is required.");
                return;
            }
            if (!/^[A-Z0-9_]+$/.test(sId)) {
                MessageBox.error("Table ID must be uppercase letters, numbers, and underscores only.");
                return;
            }
            if (!sDesc) {
                MessageBox.error("Description is required.");
                return;
            }
            if (!sSource) {
                MessageBox.error("Source Table is required.");
                return;
            }
            if (!sOutputKey) {
                MessageBox.error("Output Key is required (Field Mapping tab).");
                this.byId("detailTabs").setSelectedKey("mapping");
                return;
            }
            if (!sOutputDesc) {
                MessageBox.error("Output Description is required (Field Mapping tab).");
                this.byId("detailTabs").setSelectedKey("mapping");
                return;
            }

            this._oViewModel.setProperty("/busy", true);

            var bIsNew = this._oViewModel.getProperty("/isNew");
            var oCtx   = this.getView().getBindingContext();

            if (oCtx) {
                // description, source_table, output_*, input_* are two-way bound,
                // so they are already pending. Only handle the key + status here.
                if (bIsNew) {
                    oCtx.setProperty("value_table_id", sId);
                }
                // status comes from the Switch (not directly bound to a string)
                oCtx.setProperty("status",
                    this.byId("swStatus").getState() ? "ACTIVE" : "INACTIVE");
            }

            var oModel = this.getOwnerComponent().getModel();
            oModel.submitBatch("valueTableUpdate")
                .then(function () {
                    if (bIsNew && oCtx && oCtx.created) {
                        return oCtx.created().then(function () { return true; });
                    }
                    return false;
                })
                .then(function (bWasCreated) {
                    this._oViewModel.setProperty("/busy",    false);
                    this._oViewModel.setProperty("/isDirty", false);
                    MessageToast.show("Value table saved successfully.");

                    if (bWasCreated) {
                        this._oCreateListBinding = null;
                        this.onNavBack();
                    } else if (oCtx) {
                        oCtx.requestObject().then(function (oData) {
                            if (oData) { this._refreshHeader(oData); }
                        }.bind(this));
                    }
                }.bind(this))
                .catch(function (oErr) {
                    this._oViewModel.setProperty("/busy", false);
                    var sMsg = oErr && oErr.message ? oErr.message : "Unknown error";
                    MessageBox.error("Save failed: " + sMsg);
                }.bind(this));
        },

        // ── Cancel ───────────────────────────────────────────────────
        onCancel: function () {
            var fnGoBack = function () {
                this.getOwnerComponent().getModel().resetChanges("valueTableUpdate");
                this._oViewModel.setProperty("/isDirty", false);
                this.onNavBack();
            }.bind(this);

            if (this._oViewModel.getProperty("/isDirty")) {
                MessageBox.confirm("Discard unsaved changes?", {
                    onClose: function (sAction) {
                        if (sAction === MessageBox.Action.OK) { fnGoBack(); }
                    }
                });
            } else {
                fnGoBack();
            }
        },

        // ── Copy ─────────────────────────────────────────────────────
        onCopy: function () {
            var oCtx = this.getView().getBindingContext();
            if (!oCtx) {
                MessageToast.show("No value table selected to copy.");
                return;
            }
            this.getOwnerComponent().getModel().resetChanges("valueTableUpdate");
            oCtx.requestObject().then(function (oData) {
                var oModel = this.getOwnerComponent().getModel();
                var oListBinding = oModel.bindList("/ValueTables", null, [], [], {
                    $$updateGroupId: "valueTableUpdate"
                });
                var oNewCtx = oListBinding.create({
                    value_table_id: "",
                    description   : oData.description + " (Copy)",
                    source_table  : oData.source_table,
                    input_1       : oData.input_1,
                    input_2       : oData.input_2,
                    input_3       : oData.input_3,
                    output_key    : oData.output_key,
                    output_desc   : oData.output_desc,
                    status        : "INACTIVE"
                });
                this._oCreateListBinding = oListBinding;
                this.getView().setBindingContext(oNewCtx);
                this._oViewModel.setProperty("/isNew",   true);
                this._oViewModel.setProperty("/isDirty", true);
                this.byId("inId").setEditable(true);

                this._refreshHeader({
                    value_table_id: "",
                    description   : oData.description + " (Copy)",
                    source_table  : oData.source_table,
                    status        : "INACTIVE"
                });

                this.byId("detailTabs").setSelectedKey("general");
                MessageToast.show("Value table copied — enter a new Table ID and press Save.");
            }.bind(this));
        },

        // ── Test Query ───────────────────────────────────────────────
        onTestQuery: function () {
            var sSource     = this.byId("inSourceTable").getValue().trim();
            var sOutputKey  = this.byId("inOutputKey").getValue().trim();
            var sOutputDesc = this.byId("inOutputDesc").getValue().trim();

            if (!sSource) {
                MessageBox.warning("Enter a Backend Table before testing the query.");
                return;
            }
            if (!sOutputKey || !sOutputDesc) {
                MessageBox.warning("Output Key and Output Description are required to test the query (Output Columns tab).");
                this.byId("detailTabs").setSelectedKey("output");
                return;
            }
            // In a real system this would call a backend action to run a sample
            // query against sSource. Here we surface the would-be query for review.
            MessageBox.information(
                "Sample query prepared:\n\n" +
                "SELECT " + sOutputKey + ", " + sOutputDesc + "\n" +
                "FROM " + sSource + "\n\n" +
                "Connect the backend validation action to run this against the source system.",
                { title: "Test Query" }
            );
        },

        // ── Backend table value help (stub) ──────────────────────────
        onSourceTableValueHelp: function () {
            MessageToast.show("Backend table search help — connect to the SAP DDIC catalog.");
        },

        // ── Navigation ───────────────────────────────────────────────
        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("valueTables");
        }
    });
});