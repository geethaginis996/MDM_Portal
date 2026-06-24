sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("mdm.portal.controller.MyRequestDetail", {

        onInit: function () {
            var oViewModel = new JSONModel({
                busy         : false,
                crId         : "",
                status       : "",
                type         : "",
                category     : "",
                accountGroup : "",
                requester    : "",
                createdAt    : "",
                bpNumber     : "",
                subtitle     : "",
                roleCount    : "0",
                fieldCount   : "0"
            });
            this.getView().setModel(oViewModel, "view");
            this.getView().setModel(new JSONModel({ roles: [], fieldValues: [] }), "detail");

            var oRouter = this.getOwnerComponent().getRouter();
            oRouter.getRoute("myRequestDetail").attachPatternMatched(this._onRouteMatched, this);
        },

        _onRouteMatched: function (oEvent) {
            var sCrId = decodeURIComponent(oEvent.getParameter("arguments").crId);
            this._loadCR(sCrId);
        },

        _loadCR: function (sCrId) {
            var oVm    = this.getView().getModel("view");
            var oModel = this.getOwnerComponent().getModel();
            oVm.setProperty("/busy", true);
            oVm.setProperty("/crId", sCrId);

            // Use fetch for reliable $expand support with child arrays
            var sUrl = oModel.getServiceUrl().replace(/\/$/, "")
                + "/ChangeRequests('" + encodeURIComponent(sCrId) + "')"
                + "?$expand=bp_roles,field_values";

            fetch(sUrl, { headers: { Accept: "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (oData) {
                oVm.setProperty("/busy",         false);
                oVm.setProperty("/crId",         sCrId);
                oVm.setProperty("/status",       oData.status       || "\u2014");
                oVm.setProperty("/type",         oData.request_type || "\u2014");
                oVm.setProperty("/category",     oData.bp_category_category_id || "\u2014");
                oVm.setProperty("/accountGroup", oData.account_group_account_group_id || "\u2014");
                oVm.setProperty("/requester",    oData.requester    || "\u2014");
                oVm.setProperty("/bpNumber",     oData.posted_object_no || "\u2014");
                oVm.setProperty("/createdAt",    oData.createdAt
                    ? new Date(oData.createdAt).toLocaleString() : "\u2014");
                oVm.setProperty("/subtitle",
                    (oData.request_type || "") + " \u00b7 " +
                    (oData.bp_category_category_id || "") + " \u00b7 " +
                    (oData.status || ""));

                var aRoles    = oData.bp_roles     || oData["bp_roles@odata.count"] || [];
                var aFvs      = oData.field_values || [];

                // OData may wrap arrays in { value: [...] }
                if (aRoles && aRoles.value)    { aRoles = aRoles.value; }
                if (aFvs   && aFvs.value)      { aFvs   = aFvs.value;   }

                // Ensure arrays
                if (!Array.isArray(aRoles)) { aRoles = []; }
                if (!Array.isArray(aFvs))   { aFvs   = []; }

                console.log("[MyRequestDetail] bp_roles:", aRoles.length, "field_values:", aFvs.length);
                if (aRoles.length) { console.log("[MyRequestDetail] first role:", JSON.stringify(aRoles[0])); }

                // Set counts and raw data immediately so the tabs show something.
                // Use setData on the whole model to force a complete refresh.
                var oDetail = this.getView().getModel("detail");
                oDetail.setData({ roles: aRoles, fieldValues: aFvs });
                oVm.setProperty("/roleCount",  String(aRoles.length));
                oVm.setProperty("/fieldCount", String(aFvs.length));

                // Then enrich with descriptions in the background
                this._enrichAndLoad(aRoles, aFvs);

            }.bind(this)).catch(function (oErr) {
                oVm.setProperty("/busy", false);
                MessageBox.error("Could not load change request: " +
                    ((oErr && oErr.message) || String(oErr)));
            }.bind(this));
        },

        _enrichAndLoad: function (aRoles, aFieldVals) {
            var oDetailModel = this.getView().getModel("detail");
            var oVm          = this.getView().getModel("view");
            var oModel       = this.getOwnerComponent().getModel();
            var sBase        = oModel.getServiceUrl().replace(/\/$/, "");

            // Normalise property names — OData CAP serialises association keys as:
            // CRBPRole.role (Association to BPRole) → role_role_id in JSON
            // CRFieldValue.field (Association to FieldMaster) → field_field_id in JSON
            var aNormRoles = aRoles.map(function (r) {
                return {
                    role_role_id  : r.role_role_id  || r.role_id   || "",
                    roleDesc      : "",
                    instance_no   : r.instance_no,
                    instance_key_1: r.instance_key_1 || "",
                    auto_pulled   : !!r.auto_pulled
                };
            });
            var aNormFvs = aFieldVals.map(function (fv) {
                return {
                    role_id       : fv.role_id        || "",
                    field_field_id: fv.field_field_id || fv.field_id || "",
                    fieldDesc     : "",
                    new_value     : fv.new_value      || "",
                    instance_no   : fv.instance_no
                };
            });

            // Set normalised data immediately — triggers binding refresh
            oDetailModel.setData({ roles: aNormRoles, fieldValues: aNormFvs });
            oVm.setProperty("/roleCount",  String(aNormRoles.length));
            oVm.setProperty("/fieldCount", String(aNormFvs.length));

            // Enrich roles with descriptions in background
            fetch(sBase + "/BPRoles?$select=role_id,description",
                  { headers: { Accept: "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (oData) {
                var mRoleMeta = {};
                ((oData && oData.value) || []).forEach(function (r) {
                    mRoleMeta[r.role_id] = r.description || "";
                });
                aNormRoles.forEach(function (r) {
                    r.roleDesc = mRoleMeta[r.role_role_id] || r.role_role_id;
                });
                oDetailModel.setProperty("/roles", aNormRoles.slice());
            }).catch(function () {});

            // Enrich field values with descriptions in background
            fetch(sBase + "/FieldMasters?$select=field_id,description",
                  { headers: { Accept: "application/json" } })
            .then(function (r) { return r.json(); })
            .then(function (oData) {
                var mFieldMeta = {};
                ((oData && oData.value) || []).forEach(function (f) {
                    mFieldMeta[f.field_id] = f.description || "";
                });
                aNormFvs.forEach(function (fv) {
                    fv.fieldDesc = mFieldMeta[fv.field_field_id] || fv.field_field_id;
                });
                aNormFvs.sort(function (a, b) {
                    if (a.role_id < b.role_id) { return -1; }
                    if (a.role_id > b.role_id) { return  1; }
                    return 0;
                });
                oDetailModel.setProperty("/fieldValues", aNormFvs.slice());
            }).catch(function () {});
        },

        onTabSelect: function () { /* future: lazy-load per tab */ },

        onEditDraft: function () {
            var sCrId  = this.getView().getModel("view").getProperty("/crId");
            var sStatus = this.getView().getModel("view").getProperty("/status");
            if (sStatus !== "DRAFT") {
                MessageBox.warning("Only DRAFT requests can be edited.");
                return;
            }
            // Navigate to Create BP screen with the CR ID so it pre-loads the form
            this.getOwnerComponent().getRouter().navTo("createBPEdit", {
                crId: encodeURIComponent(sCrId)
            });
        },

        onSubmit: function () {
            var sCrId = this.getView().getModel("view").getProperty("/crId");
            MessageBox.confirm("Submit change request " + sCrId + " for approval?", {
                title   : "Submit",
                actions : [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose : function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        MessageToast.show("Submit action — coming in next sprint");
                    }
                }
            });
        },

        onCancelRequest: function () {
            MessageBox.confirm("Cancel this change request?", {
                title   : "Cancel Request",
                actions : [MessageBox.Action.YES, MessageBox.Action.NO],
                onClose : function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        MessageToast.show("Cancel action — coming in next sprint");
                    }
                }
            });
        },

        onNavHome: function () {
            this.getOwnerComponent().getRouter().navTo("home", {}, true);
        },

        onNavList: function () {
            this.getOwnerComponent().getRouter().navTo("myRequests");
        }
    });
});